namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Turns connected active plate-boundary systems into finite crustal
/// deformation budgets. Boundary cells establish geometry and activity; they
/// do not receive independent height multipliers. Collision, subduction,
/// continental rifting, and transform motion each use a distinct coherent
/// cross-section, while lithospheric support later converts thickness to
/// regional surface height.
/// </summary>
internal sealed class OrogenicConstructionLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "orogenic-construction",
        0x7249d3,
        PhysicalGeographyFacts.TectonicProvinces |
        PhysicalGeographyFacts.ContinentalSutures |
        PhysicalGeographyFacts.TectonicMargins |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.LandscapeHistory,
        PhysicalGeographyFacts.OrogenicConstruction | PhysicalGeographyFacts.Elevation,
        PhysicalGeographyFacts.CrustalSupport |
        PhysicalGeographyFacts.VolcanicConstruction |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.Fractures |
        PhysicalGeographyFacts.Geothermal |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.Warmth |
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.AtmosphericFlow |
        PhysicalGeographyFacts.Moisture |
        PhysicalGeographyFacts.Precipitation |
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.DrainageConditioning |
        PhysicalGeographyFacts.Lakes |
        PhysicalGeographyFacts.FlowRouting |
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.IceFlow |
        PhysicalGeographyFacts.SeaIce |
        PhysicalGeographyFacts.GlacialMeltwater |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.RiverGeometry |
        PhysicalGeographyFacts.Floodplains |
        PhysicalGeographyFacts.Deltas |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.OrogenicComponentIds.Fill(-1);
        map.OrogenicSystemProminence.Clear();
        map.OrogenicConstruction.Clear();
        var boundaryIds = new int[map.Grid.TriangleCount];
        Array.Fill(boundaryIds, -1);
        var components = DiscoverComponents(map, context.Profile, boundaryIds);
        RankComponents(context, components);
        var frame = PropagateInfluence(map, context.Profile, components, boundaryIds);
        ConstructCrust(map, context, components, frame);
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var thickness = PhysicalElevation.ToUnits(map.CrustThickness[triangleIndex]);
            if (map.OrogenicComponentIds[triangleIndex] < -1 ||
                thickness < PhysicalCrust.MinimumThicknessUnits ||
                thickness > PhysicalCrust.MaximumThicknessUnits ||
                (map.OrogenicConstruction[triangleIndex] != 0 &&
                    map.OrogenicComponentIds[triangleIndex] < 0))
            {
                throw new InvalidOperationException(
                    "Orogenic construction produced inconsistent crustal state.");
            }
        }
    }

    private static List<BoundaryComponent> DiscoverComponents(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int[] boundaryIds)
    {
        var components = new List<BoundaryComponent>();
        var frontier = new Queue<int>();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (boundaryIds[triangleIndex] >= 0 ||
                !IsActiveBoundary(map, triangleIndex, profile.OrogenicMinimumStrain))
            {
                continue;
            }

            var component = new BoundaryComponent(
                components.Count,
                map.TectonicBoundaryCodes[triangleIndex],
                map.TectonicBoundaryPairIds[triangleIndex]);
            components.Add(component);
            boundaryIds[triangleIndex] = component.Id;
            frontier.Enqueue(triangleIndex);
            FloodComponent(map, profile, boundaryIds, frontier, component);
        }

        return components;
    }

    private static void FloodComponent(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int[] boundaryIds,
        Queue<int> frontier,
        BoundaryComponent component)
    {
        while (frontier.TryDequeue(out var triangleIndex))
        {
            component.Add(map, triangleIndex);
            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
                if (neighbor < 0 || boundaryIds[neighbor] >= 0 ||
                    map.TectonicBoundaryCodes[neighbor] != component.BoundaryCode ||
                    map.TectonicBoundaryPairIds[neighbor] != component.BoundaryPairId ||
                    !IsActiveBoundary(map, neighbor, profile.OrogenicMinimumStrain))
                {
                    continue;
                }

                boundaryIds[neighbor] = component.Id;
                frontier.Enqueue(neighbor);
            }
        }
    }

    private static void RankComponents(
        PhysicalGeographyGenerationContext context,
        IReadOnlyList<BoundaryComponent> components)
    {
        var profile = context.Profile;
        foreach (var component in components)
        {
            component.Prominence = profile.OrogenicProminenceMinimum;
        }

        var ranked = components
            .Where(component =>
                component.BoundaryCode == PhysicalTectonicBoundaryCodes.Convergent &&
                component.CellCount >= profile.OrogenicMinimumComponentSize &&
                component.MaximumContinentalFraction >= 0.35d)
            .OrderByDescending(component => ComponentScore(component, context))
            .ThenBy(component => component.BoundaryPairId)
            .ToArray();
        for (var rank = 0; rank < ranked.Length; rank++)
        {
            var share = Math.Exp(-rank / profile.OrogenicProminenceRankDecay);
            ranked[rank].Prominence = (int)Math.Round(
                profile.OrogenicProminenceMinimum +
                    ((profile.OrogenicProminenceMaximum - profile.OrogenicProminenceMinimum) * share),
                MidpointRounding.AwayFromZero);
        }
    }

    private static double ComponentScore(
        BoundaryComponent component,
        PhysicalGeographyGenerationContext context)
    {
        var variation = PhysicalNoise.HashUnit(
            context.EpochStableSeed ^ 0x35a7,
            component.BoundaryPairId,
            component.CentroidX ^ (component.CentroidY << 8));
        var size = Math.Log2(component.CellCount + 1d);
        var continentalCollision = Math.Max(component.MeanCollision, component.MeanSuture);
        return size * (0.70d + (variation * 0.60d)) *
            (0.55d + component.MeanStrain) *
            (1d + (continentalCollision * 3.20d)) *
            (0.35d + component.MeanContinentalFraction +
                (component.MaximumContinentalFraction * 0.45d));
    }

    private static bool IsActiveBoundary(
        PhysicalGeographyField map,
        int triangleIndex,
        int minimumStrain) =>
        map.TectonicBoundaryCodes[triangleIndex] != PhysicalTectonicBoundaryCodes.None &&
        map.TectonicStrain[triangleIndex] >= minimumStrain;

    private static OrogenicFrame PropagateInfluence(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        IReadOnlyList<BoundaryComponent> components,
        ReadOnlySpan<int> boundaryIds)
    {
        var distance = new int[map.Grid.TriangleCount];
        var source = new int[map.Grid.TriangleCount];
        Array.Fill(distance, int.MaxValue);
        Array.Fill(source, -1);
        var frontier = new Queue<int>();
        SeedInfluence(map, profile, components, boundaryIds, distance, source, frontier);
        ExpandInfluence(map, profile.OrogenicInfluenceReach, distance, source, frontier);
        return new OrogenicFrame(distance, source);
    }

    private static void SeedInfluence(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        IReadOnlyList<BoundaryComponent> components,
        ReadOnlySpan<int> boundaryIds,
        int[] distance,
        int[] source,
        Queue<int> frontier)
    {
        for (var triangleIndex = 0; triangleIndex < boundaryIds.Length; triangleIndex++)
        {
            var componentId = boundaryIds[triangleIndex];
            if (componentId < 0 ||
                components[componentId].CellCount < profile.OrogenicMinimumComponentSize)
            {
                continue;
            }

            map.OrogenicComponentIds[triangleIndex] = componentId;
            map.OrogenicSystemProminence[triangleIndex] = components[componentId].Prominence;
            distance[triangleIndex] = 0;
            source[triangleIndex] = triangleIndex;
            frontier.Enqueue(triangleIndex);
        }
    }

    private static void ExpandInfluence(
        PhysicalGeographyField map,
        int reach,
        int[] distance,
        int[] source,
        Queue<int> frontier)
    {
        while (frontier.TryDequeue(out var triangleIndex))
        {
            var nextDistance = distance[triangleIndex] + 1;
            if (nextDistance > reach)
            {
                continue;
            }

            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
                if (neighbor < 0 || distance[neighbor] <= nextDistance)
                {
                    continue;
                }

                distance[neighbor] = nextDistance;
                source[neighbor] = source[triangleIndex];
                map.OrogenicComponentIds[neighbor] =
                    map.OrogenicComponentIds[triangleIndex];
                map.OrogenicSystemProminence[neighbor] =
                    map.OrogenicSystemProminence[triangleIndex];
                frontier.Enqueue(neighbor);
            }
        }
    }

    private static void ConstructCrust(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        IReadOnlyList<BoundaryComponent> components,
        OrogenicFrame frame)
    {
        var step = context.IsEvolutionEpoch
            ? context.Profile.EpochOrogenicConstructionStep * context.TectonicStrength / 1000d
            : context.Profile.InitialOrogenicConstructionStep;
        if (step <= 0d)
        {
            return;
        }

        MeasureConstructionWeights(map, context, components, frame);

        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var componentId = map.OrogenicComponentIds[triangleIndex];
            if (componentId < 0)
            {
                continue;
            }

            ConstructTriangle(
                map,
                context,
                components[componentId],
                frame,
                triangleIndex,
                step);
        }
    }

    private static void MeasureConstructionWeights(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        IReadOnlyList<BoundaryComponent> components,
        OrogenicFrame frame)
    {
        foreach (var component in components)
        {
            component.TotalConstructionWeight = 0d;
        }

        if (!context.IsEvolutionEpoch)
        {
            return;
        }

        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var componentId = map.OrogenicComponentIds[triangleIndex];
            if (componentId < 0 ||
                components[componentId].BoundaryCode != PhysicalTectonicBoundaryCodes.Convergent)
            {
                continue;
            }

            var component = components[componentId];
            component.TotalConstructionWeight += ConstructionWeight(
                map,
                context,
                component,
                frame,
                triangleIndex);
        }
    }

    private static void ConstructTriangle(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        BoundaryComponent component,
        OrogenicFrame frame,
        int triangleIndex,
        double step)
    {
        var source = frame.Source[triangleIndex];
        var crossSection = CrossSection(
            map,
            context.Profile,
            component,
            triangleIndex,
            source,
            frame.Distance[triangleIndex]);
        var weight = ConstructionWeight(
            map,
            context,
            component,
            frame,
            triangleIndex,
            crossSection);
        var authoredDrive = step * ComponentProminence(component) * weight;
        var heightDrive = context.IsEvolutionEpoch &&
            component.BoundaryCode == PhysicalTectonicBoundaryCodes.Convergent
                ? authoredDrive + DistributedShorteningDrive(
                    map,
                    context,
                    component,
                    triangleIndex,
                    weight)
                : authoredDrive;
        if (Math.Abs(heightDrive) < 0.5d)
        {
            return;
        }

        var admitted = ApplyThicknessChange(
            map,
            context.Profile,
            component,
            triangleIndex,
            crossSection,
            heightDrive);
        map.OrogenicConstruction[triangleIndex] = admitted;
        RecordActivity(map, context.Profile, triangleIndex, admitted);
        ConstructSurfaceRelief(
            map,
            context,
            component,
            triangleIndex,
            source,
            crossSection,
            admitted);
    }

    private static void ConstructSurfaceRelief(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        BoundaryComponent component,
        int triangleIndex,
        int source,
        double crossSection,
        long admitted)
    {
        var admittedUnits = PhysicalElevation.ToUnits(admitted);
        var continental = map.CrustContinentalFraction[triangleIndex] / 1000d;
        if (admittedUnits <= 0d || continental < 0.35d ||
            component.BoundaryCode != PhysicalTectonicBoundaryCodes.Convergent)
        {
            return;
        }

        var crest = Math.Clamp(crossSection / 1.55d, 0d, 1d);
        var summitVariation = SummitVariation(map, context, component, triangleIndex, source);
        var constructedUnits = Math.Min(
            context.Profile.MaximumOrogenicSurfaceReliefPerPass,
            admittedUnits * context.Profile.OrogenicSurfaceReliefSharePerMille / 1000d *
                (0.38d + (Math.Sqrt(crest) * 0.62d)) * summitVariation);
        var requested = PhysicalElevation.FromUnits(constructedUnits);
        if (requested <= 0)
        {
            return;
        }

        var minimum = PhysicalElevation.FromUnits(PhysicalCrust.MinimumHeightUnits);
        var maximum = PhysicalElevation.FromUnits(PhysicalCrust.MaximumHeightUnits) -
            map.SedimentThickness[triangleIndex];
        var oldBedrock = map.BedrockElevation[triangleIndex];
        var nextBedrock = Math.Clamp(checked(oldBedrock + requested), minimum, maximum);
        var applied = nextBedrock - oldBedrock;
        if (applied <= 0)
        {
            return;
        }

        map.BedrockElevation[triangleIndex] = nextBedrock;
        map.SurfaceRockLoad[triangleIndex] = checked(
            map.SurfaceRockLoad[triangleIndex] + applied);
        var resistanceInfluence = Math.Clamp(
            Math.Sqrt(crest) * ComponentProminence(component) / 1.75d,
            0d,
            1d);
        map.RockResistance[triangleIndex] = Math.Max(
            map.RockResistance[triangleIndex],
            (int)Math.Round(
                PhysicalRock.BaselineResistance +
                    ((context.Profile.OrogenicCoreRockResistance -
                        PhysicalRock.BaselineResistance) * resistanceInfluence),
                MidpointRounding.AwayFromZero));
        LandscapeSurface.Rebuild(map, triangleIndex);
    }

    private static double SummitVariation(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        BoundaryComponent component,
        int triangleIndex,
        int source)
    {
        var tangentX = map.TectonicTangentX[source] / 1000d;
        var tangentY = map.TectonicTangentY[source] / 1000d;
        if (Math.Abs(tangentX) + Math.Abs(tangentY) < 0.01d)
        {
            tangentX = 1d;
        }

        var along = (map.Grid.TriangleX(triangleIndex) * tangentX) +
            (map.Grid.TriangleY(triangleIndex) * tangentY);
        var peak = PhysicalNoise.UnitNoise(
            along,
            component.Id * 31d,
            context.EpochStableSeed ^ 0x19d7,
            Math.Max(3d, context.Profile.OrogenicAlongStrikeScale * 0.28d),
            3);
        return 0.72d + (Math.Pow(peak, 2.1d) * 0.68d);
    }

    private static double ConstructionWeight(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        BoundaryComponent component,
        OrogenicFrame frame,
        int triangleIndex)
    {
        var source = frame.Source[triangleIndex];
        var crossSection = CrossSection(
            map,
            context.Profile,
            component,
            triangleIndex,
            source,
            frame.Distance[triangleIndex]);
        return ConstructionWeight(
            map,
            context,
            component,
            frame,
            triangleIndex,
            crossSection);
    }

    private static double ConstructionWeight(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        BoundaryComponent component,
        OrogenicFrame frame,
        int triangleIndex,
        double crossSection)
    {
        var source = frame.Source[triangleIndex];
        var localStrain = map.TectonicStrain[source] / 1000d;
        var activity = (localStrain * 0.62d) + (component.MeanStrain * 0.38d);
        var alongStrike = AlongStrikeVariation(
            map,
            context,
            component,
            triangleIndex,
            source);
        return activity * alongStrike * crossSection;
    }

    private static double DistributedShorteningDrive(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        BoundaryComponent component,
        int triangleIndex,
        double weight)
    {
        if (weight <= 0d || component.TotalConstructionWeight <= 0d ||
            component.ShorteningTotalUnits <= 0d)
        {
            return 0d;
        }

        var retainedShare = (0.30d + (component.MeanCollision * 0.70d)) *
            context.TectonicStrength / 1000d;
        var thickness = component.ShorteningTotalUnits * retainedShare *
            weight / component.TotalConstructionWeight;
        var continentalFraction = map.CrustContinentalFraction[triangleIndex] / 1000d;
        return thickness * PhysicalCrust.BuoyancyPerMille(continentalFraction) / 1000d;
    }

    private static double CrossSection(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        BoundaryComponent component,
        int triangleIndex,
        int source,
        int distance) => component.BoundaryCode switch
        {
            PhysicalTectonicBoundaryCodes.Convergent => ConvergentCrossSection(
                map, profile, component, triangleIndex, source, distance),
            PhysicalTectonicBoundaryCodes.Divergent => RiftCrossSection(
                map, profile, triangleIndex, distance),
            PhysicalTectonicBoundaryCodes.Transform => TransformCrossSection(
                map, profile, triangleIndex, distance),
            _ => 0d,
        };

    private static double ConvergentCrossSection(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        BoundaryComponent component,
        int triangleIndex,
        int source,
        double distance)
    {
        var continental = map.CrustContinentalFraction[triangleIndex] / 1000d;
        var localCollision = map.CrustCollisionIntensity[source] / 1000d;
        var collisionMix = Math.Clamp(
            (Math.Max(localCollision, component.MeanCollision) - 0.08d) / 0.42d,
            0d,
            1d);
        var collision = CollisionCrossSection(profile, distance) *
            (0.40d + (continental * 0.60d));
        var subduction = SubductionCrossSection(profile, distance) * continental;
        return (subduction * (1d - collisionMix)) + (collision * collisionMix);
    }

    private static double CollisionCrossSection(
        PhysicalGeographyGenerationProfile profile,
        double distance)
    {
        var width = profile.CollisionRangeWidth;
        var root = Gaussian(distance, 0d, width) * 0.42d;
        var firstCrest = Gaussian(distance, width * 0.28d, width * 0.17d) * 0.90d;
        var secondCrest = Gaussian(distance, width * 0.72d, width * 0.21d) * 0.68d;
        return root + firstCrest + secondCrest;
    }

    private static double SubductionCrossSection(
        PhysicalGeographyGenerationProfile profile,
        double distance)
    {
        var width = profile.SubductionRangeWidth;
        var root = Gaussian(distance, 0d, width) * 0.26d;
        var crest = Gaussian(distance, width * 0.42d, width * 0.25d) * 1.02d;
        return root + crest;
    }

    private static double RiftCrossSection(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex,
        double distance)
    {
        var continental = map.CrustContinentalFraction[triangleIndex] / 1000d;
        var shoulderDistance = profile.RiftShoulderDistance;
        var axis = Gaussian(distance, 0d, Math.Max(2d, shoulderDistance * 0.48d));
        var shoulders = Gaussian(
            distance,
            shoulderDistance,
            Math.Max(2d, shoulderDistance * 0.42d));
        return continental * ((shoulders * 0.55d) - (axis * 0.76d));
    }

    private static double TransformCrossSection(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex,
        double distance)
    {
        var continental = map.CrustContinentalFraction[triangleIndex] / 1000d;
        return Gaussian(distance, 0d, profile.TransformRangeWidth) *
            (0.06d + (continental * 0.14d));
    }

    private static double ComponentProminence(BoundaryComponent component) =>
        component.Prominence / 1000d;

    private static double AlongStrikeVariation(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        BoundaryComponent component,
        int triangleIndex,
        int source)
    {
        var tangentX = map.TectonicTangentX[source] / 1000d;
        var tangentY = map.TectonicTangentY[source] / 1000d;
        if (Math.Abs(tangentX) + Math.Abs(tangentY) < 0.01d)
        {
            tangentX = 1d;
            tangentY = 0d;
        }

        var x = map.Grid.TriangleX(triangleIndex);
        var y = map.Grid.TriangleY(triangleIndex);
        var along = (x * tangentX) + (y * tangentY);
        var noise = PhysicalNoise.UnitNoise(
            along,
            component.Id * 19d,
            context.EpochStableSeed ^ 0x6c91,
            context.Profile.OrogenicAlongStrikeScale,
            3);
        return 0.74d + (Math.Pow(noise, 1.7d) * 0.54d);
    }

    private static long ApplyThicknessChange(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        BoundaryComponent component,
        int triangleIndex,
        double crossSection,
        double heightDrive)
    {
        var continentalFraction = map.CrustContinentalFraction[triangleIndex] / 1000d;
        var buoyancy = PhysicalCrust.BuoyancyPerMille(continentalFraction) / 1000d;
        var currentThickness = PhysicalElevation.ToUnits(map.CrustThickness[triangleIndex]);
        var requestedThickness = currentThickness + (heightDrive / buoyancy);
        var budgetLimit = DeformationBudgetLimit(
            profile,
            component,
            continentalFraction,
            crossSection,
            heightDrive);
        var nextThickness = heightDrive > 0d
            ? Math.Min(requestedThickness, Math.Max(currentThickness, budgetLimit))
            : Math.Max(requestedThickness, Math.Min(currentThickness, budgetLimit));
        nextThickness = PhysicalCrust.ClampThicknessUnits(nextThickness);
        map.CrustThickness[triangleIndex] = PhysicalElevation.FromUnits(nextThickness);
        return PhysicalElevation.FromUnits(
            PhysicalCrust.HeightUnits(nextThickness, continentalFraction) -
            PhysicalCrust.HeightUnits(currentThickness, continentalFraction));
    }

    private static double DeformationBudgetLimit(
        PhysicalGeographyGenerationProfile profile,
        BoundaryComponent component,
        double continentalFraction,
        double crossSection,
        double heightDrive)
    {
        var foundation = PhysicalCrust.OceanicThicknessUnits +
            ((PhysicalCrust.ContinentalThicknessUnits - PhysicalCrust.OceanicThicknessUnits) *
                continentalFraction);
        if (heightDrive < 0d)
        {
            var thinningShape = Math.Clamp(Math.Abs(crossSection) / 0.76d, 0d, 1d);
            return foundation - (profile.ContinentalRiftThinningBudget * thinningShape);
        }

        var prominenceRange = Math.Max(
            1,
            profile.OrogenicProminenceMaximum - profile.OrogenicProminenceMinimum);
        var prominence = Math.Clamp(
            (component.Prominence - profile.OrogenicProminenceMinimum) /
                (double)prominenceRange,
            0d,
            1d);
        var rootBudget = profile.OrogenicRootBudgetMinimum +
            ((profile.OrogenicRootBudgetMaximum - profile.OrogenicRootBudgetMinimum) * prominence);
        var sectionMaximum = component.BoundaryCode switch
        {
            PhysicalTectonicBoundaryCodes.Convergent => 1.55d,
            PhysicalTectonicBoundaryCodes.Divergent => 0.55d,
            PhysicalTectonicBoundaryCodes.Transform => 0.20d,
            _ => 1d,
        };
        var rootShape = Math.Clamp(crossSection / sectionMaximum, 0d, 1d);
        return foundation + (rootBudget * rootShape);
    }

    private static void RecordActivity(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex,
        long admitted)
    {
        var admittedUnits = PhysicalElevation.ToUnits(admitted);
        var activity = Math.Min(
            int.MaxValue,
            map.TectonicActivityHistory[triangleIndex] + Math.Abs(admittedUnits));
        map.TectonicActivityHistory[triangleIndex] = activity;
        if (admittedUnits <= 0d)
        {
            return;
        }

        var uplift = admittedUnits / Math.Max(1d, profile.InitialOrogenicConstructionStep);
        map.Uplift[triangleIndex] = Math.Max(
            map.Uplift[triangleIndex],
            (float)Math.Clamp(uplift, 0d, 1.5d));
        map.RidgeInfluence[triangleIndex] = Math.Max(
            map.RidgeInfluence[triangleIndex],
            (float)Math.Clamp(uplift * 1.3d, 0d, 1d));
    }

    private static double Gaussian(double value, double center, double width)
    {
        var normalized = (value - center) / Math.Max(0.001d, width);
        return Math.Exp(-0.5d * normalized * normalized);
    }

    private sealed class BoundaryComponent(int id, int boundaryCode, int boundaryPairId)
    {
        private long _collisionTotal;
        private long _sutureTotal;
        private long _strainTotal;
        private long _continentalTotal;
        private double _xTotal;
        private double _yTotal;

        public int Id { get; } = id;

        public int BoundaryCode { get; } = boundaryCode;

        public int BoundaryPairId { get; } = boundaryPairId;

        public int Prominence { get; set; }

        public double TotalConstructionWeight { get; set; }

        public double ShorteningTotalUnits { get; private set; }

        public int CellCount { get; private set; }

        public double MeanCollision => _collisionTotal / (double)Math.Max(1, CellCount) / 1000d;

        public double MeanSuture => _sutureTotal / (double)Math.Max(1, CellCount) / 1000d;

        public double MeanStrain => _strainTotal / (double)Math.Max(1, CellCount) / 1000d;

        public double MeanContinentalFraction =>
            _continentalTotal / (double)Math.Max(1, CellCount) / 1000d;

        public double MaximumContinentalFraction { get; private set; }

        public int CentroidX => (int)Math.Round(
            _xTotal / Math.Max(1, CellCount),
            MidpointRounding.AwayFromZero);

        public int CentroidY => (int)Math.Round(
            _yTotal / Math.Max(1, CellCount),
            MidpointRounding.AwayFromZero);

        public void Add(PhysicalGeographyField map, int triangleIndex)
        {
            CellCount++;
            _collisionTotal += map.CrustCollisionIntensity[triangleIndex];
            _sutureTotal += map.CrustSutureStrength[triangleIndex];
            _strainTotal += map.TectonicStrain[triangleIndex];
            _continentalTotal += map.CrustContinentalFraction[triangleIndex];
            MaximumContinentalFraction = Math.Max(
                MaximumContinentalFraction,
                map.CrustContinentalFraction[triangleIndex] / 1000d);
            ShorteningTotalUnits += PhysicalElevation.ToUnits(
                map.ConvergentCrustSurplus[triangleIndex]);
            _xTotal += map.Grid.TriangleX(triangleIndex);
            _yTotal += map.Grid.TriangleY(triangleIndex);
        }
    }

    private sealed record OrogenicFrame(int[] Distance, int[] Source);
}
