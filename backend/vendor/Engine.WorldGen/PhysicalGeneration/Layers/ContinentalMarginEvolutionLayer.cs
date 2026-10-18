namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Evolves crustal thickness beneath a shoreline found from the stable sea
/// datum. Ordinary margins cap how quickly the ocean floor may deepen until
/// they meet the ambient basin; they never terminate at a fixed outer band.
/// Landward terrain is left alone, so a stamped coastal plain cannot create an
/// inner escarpment. Convergent margins remain exceptional and cut a trench.
/// </summary>
internal sealed class ContinentalMarginEvolutionLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "continental-margin-evolution",
        0,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.TectonicMargins,
        PhysicalGeographyFacts.TectonicMargins,
        PhysicalGeographyFacts.CrustalSupport |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.OceanDistance |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        BuildOceanMarginFrame(map);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var distance = map.OceanMarginDistance[triangleIndex];
            if (distance <= 0)
            {
                continue;
            }

            EvolveCrust(map, context.Profile, triangleIndex, distance);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        var minimum = PhysicalElevation.FromUnits(PhysicalCrust.MinimumThicknessUnits);
        var maximum = PhysicalElevation.FromUnits(PhysicalCrust.MaximumThicknessUnits);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.OceanMarginDistance[triangleIndex] == int.MinValue ||
                map.CoastalMarginCodes[triangleIndex] is < PhysicalMarginCodes.Min or
                    > PhysicalMarginCodes.Max ||
                map.CrustThickness[triangleIndex] < minimum ||
                map.CrustThickness[triangleIndex] > maximum)
            {
                throw new InvalidOperationException("Continental margin evolution produced invalid crust.");
            }
        }
    }

    private static void BuildOceanMarginFrame(PhysicalGeographyField map)
    {
        map.OceanMarginDistance.Clear();
        map.CoastalMarginCodes.Clear();
        var frontier = new int[map.Grid.TriangleCount];
        var tail = SeedOceanCoast(map, frontier);
        SeedLandCoast(map);
        var head = 0;
        while (head < tail)
        {
            var triangleIndex = frontier[head++];
            var distance = map.OceanMarginDistance[triangleIndex];
            var nextDistance = distance + 1;

            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
                if (neighbor < 0 || map.OceanMarginDistance[neighbor] != 0 ||
                    map.WaterKindCodes[neighbor] != PhysicalWaterKindCodes.Ocean)
                {
                    continue;
                }

                map.OceanMarginDistance[neighbor] = nextDistance;
                map.CoastalMarginCodes[neighbor] = map.CoastalMarginCodes[triangleIndex];
                frontier[tail++] = neighbor;
            }
        }
    }

    private static int SeedOceanCoast(PhysicalGeographyField map, int[] frontier)
    {
        var tail = 0;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.Ocean)
            {
                continue;
            }

            var margin = AdjacentLandMargin(map, triangleIndex);
            if (margin < 0)
            {
                continue;
            }

            map.OceanMarginDistance[triangleIndex] = 1;
            map.CoastalMarginCodes[triangleIndex] = margin;
            frontier[tail++] = triangleIndex;
        }

        return tail;
    }

    private static void SeedLandCoast(PhysicalGeographyField map)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean ||
                !HasOceanNeighbor(map, triangleIndex))
            {
                continue;
            }

            map.OceanMarginDistance[triangleIndex] = -1;
            map.CoastalMarginCodes[triangleIndex] = map.MarginCodes[triangleIndex];
        }
    }

    private static bool HasOceanNeighbor(PhysicalGeographyField map, int triangleIndex)
    {
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
            if (neighbor >= 0 && map.WaterKindCodes[neighbor] == PhysicalWaterKindCodes.Ocean)
            {
                return true;
            }
        }

        return false;
    }

    private static int AdjacentLandMargin(PhysicalGeographyField map, int triangleIndex)
    {
        var selected = -1;
        var selectedPriority = -1;
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
            if (neighbor < 0 || map.WaterKindCodes[neighbor] == PhysicalWaterKindCodes.Ocean)
            {
                continue;
            }

            var margin = map.MarginCodes[neighbor];
            var priority = MarginPriority(margin);
            if (priority > selectedPriority)
            {
                selected = margin;
                selectedPriority = priority;
            }
        }

        return selected;
    }

    private static int MarginPriority(int margin) => margin switch
    {
        PhysicalMarginCodes.Convergent => 4,
        PhysicalMarginCodes.Rifted => 3,
        PhysicalMarginCodes.Transform => 2,
        PhysicalMarginCodes.Passive => 1,
        _ => 0,
    };

    private static void EvolveCrust(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex,
        int distance)
    {
        var margin = map.CoastalMarginCodes[triangleIndex];
        var currentDepth = Math.Max(
            1d,
            PhysicalElevation.ToUnits(
                map.EffectiveSeaLevel - map.Elevation[triangleIndex]));
        var desiredDepth = DesiredDepth(profile, margin, distance, currentDepth);
        var desiredElevation = checked(
            map.EffectiveSeaLevel - PhysicalElevation.FromUnits(desiredDepth));
        var heightDifference = PhysicalElevation.ToUnits(
            desiredElevation - map.Elevation[triangleIndex]);
        if (Math.Abs(heightDifference) < 0.5d)
        {
            return;
        }

        var continentalFraction = map.CrustContinentalFraction[triangleIndex] / 1000d;
        var buoyancy = PhysicalCrust.BuoyancyPerMille(continentalFraction) / 1000d;
        var thickness = PhysicalElevation.ToUnits(map.CrustThickness[triangleIndex]);
        var adjustment = heightDifference / buoyancy *
            profile.MarginEvolutionResponsePerMille / 1000d;
        map.CrustThickness[triangleIndex] = PhysicalElevation.FromUnits(
            PhysicalCrust.ClampThicknessUnits(thickness + adjustment));
    }

    private static double DesiredDepth(
        PhysicalGeographyGenerationProfile profile,
        int margin,
        int distance,
        double currentDepth)
    {
        if (margin == PhysicalMarginCodes.Convergent)
        {
            return ConvergentDepth(profile, distance, currentDepth);
        }

        var shelfWidth = ShelfWidth(profile, margin);
        var shelfDepth = ShelfDepth(profile, margin);
        if (distance <= shelfWidth)
        {
            var shelfCap = 12d +
                ((shelfDepth - 12d) * Smooth(distance / (double)shelfWidth));
            return Math.Min(currentDepth, shelfCap);
        }

        var maximumStep = MaximumStep(profile, margin);
        var oceanward = distance - shelfWidth;
        var depthCap = shelfDepth + AcceleratingRiseDepth(
            oceanward,
            profile.ContinentalRiseMinimumWidth,
            maximumStep);
        return Math.Min(currentDepth, depthCap);
    }

    private static int ShelfWidth(PhysicalGeographyGenerationProfile profile, int margin) =>
        margin switch
        {
            PhysicalMarginCodes.Rifted => profile.RiftedShelfWidth,
            PhysicalMarginCodes.Transform => profile.TransformShelfWidth,
            _ => profile.PassiveShelfWidth,
        };

    private static double ShelfDepth(PhysicalGeographyGenerationProfile profile, int margin) =>
        profile.ContinentalShelfDepth * (margin switch
        {
            PhysicalMarginCodes.Rifted => 1.35d,
            PhysicalMarginCodes.Transform => 1.15d,
            _ => 1d,
        });

    private static int MaximumStep(PhysicalGeographyGenerationProfile profile, int margin) =>
        margin switch
        {
            PhysicalMarginCodes.Rifted => profile.RiftedMarginMaximumStep,
            PhysicalMarginCodes.Transform => profile.TransformMarginMaximumStep,
            _ => profile.PassiveMarginMaximumStep,
        };

    private static double ConvergentDepth(
        PhysicalGeographyGenerationProfile profile,
        int distance,
        double currentDepth)
    {
        const int trenchWidth = 5;
        var ambientDepth = Math.Max(
            profile.ContinentalSlopeDepth,
            profile.OceanicSubsidenceDepth +
                Math.Abs(PhysicalCrust.OceanicFoundationHeightUnits));
        if (distance <= trenchWidth)
        {
            var trench = profile.ConvergentTrenchDepth *
                Smooth(distance / (double)trenchWidth);
            return Math.Max(currentDepth, ambientDepth + trench);
        }

        var recovery = Math.Clamp(
            (distance - trenchWidth) / (double)profile.ContinentalSlopeWidth,
            0d,
            1d);
        if (recovery >= 1d)
        {
            return currentDepth;
        }

        var remainingTrench = profile.ConvergentTrenchDepth * (1d - Smooth(recovery));
        return Math.Max(currentDepth, ambientDepth + remainingTrench);
    }

    /// <summary>
    /// Integral of a grade that accelerates linearly from zero to the authored
    /// maximum, then remains constant. Both depth and grade therefore match
    /// the nearly flat shelf at the start of the continental rise.
    /// </summary>
    private static double AcceleratingRiseDepth(int distance, int rampWidth, int maximumStep)
    {
        if (distance <= rampWidth)
        {
            return maximumStep * distance * distance / (2d * rampWidth);
        }

        return maximumStep * (distance - (rampWidth / 2d));
    }

    private static double Smooth(double value)
    {
        var clamped = Math.Clamp(value, 0d, 1d);
        return clamped * clamped * (3d - (2d * clamped));
    }
}
