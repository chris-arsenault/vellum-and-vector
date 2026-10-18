namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Builds seamounts, islands, continental cones, calderas, and lava aprons
/// where moving crust crosses stable mantle plume roots.
/// </summary>
internal sealed class VolcanicConstructionLayer : IPhysicalGeographyLayer
{
    private const int OwnedActiveFeatures = PhysicalGeographyFeatureCodes.MantlePlume;
    private const int OwnedHistoricalFeatures = PhysicalGeographyFeatureCodes.VolcanicCone |
        PhysicalGeographyFeatureCodes.VolcanicCaldera |
        PhysicalGeographyFeatureCodes.LavaPlain;

    public PhysicalGeographyLayerContract Contract { get; } = new(
        "volcanic-construction",
        0x73a91d,
        PhysicalGeographyFacts.TectonicProvinces |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.LandscapeHistory |
        PhysicalGeographyFacts.MantlePlumeRoots,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.VolcanicConstruction,
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
        PhysicalGeographyFacts.DrainageGuidance |
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
        PrepareCurrentEpoch(map, context.IsEvolutionEpoch);
        var sequence = context.IsEvolutionEpoch ? context.EpochIndex + 1 : 0;
        var recordedEpoch = context.IsEvolutionEpoch ? context.EpochIndex : 0;
        for (var root = 0; root < map.Grid.TriangleCount; root++)
        {
            var strength = map.MantlePlumeRootStrength[root];
            if (strength <= 0)
            {
                continue;
            }

            var center = AdvanceOverPlume(map, root, sequence, context.Profile);
            var caldera = PhysicalNoise.HashUnit(
                context.Seed ^ 0x2f41,
                root,
                sequence) < context.Profile.VolcanicCalderaChance / 1000d;
            ConstructCenter(map, context.Profile, center, strength, recordedEpoch, caldera);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var roots = 0;
        var constructed = 0;
        var active = 0;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            roots += map.MantlePlumeRootStrength[triangleIndex] > 0 ? 1 : 0;
            constructed += map.VolcanicConstructionHistory[triangleIndex] > 0 ? 1 : 0;
            active += map.VolcanicActivity[triangleIndex] > 0 ? 1 : 0;
            if (!StateIsValid(map, triangleIndex, context))
            {
                throw new InvalidOperationException(
                    $"Volcanic construction at triangle {triangleIndex} contains invalid provenance " +
                    $"(epoch {context.EpochIndex}, flags {map.FeatureFlags[triangleIndex]}, " +
                    $"history {map.VolcanicConstructionHistory[triangleIndex]}, activity " +
                    $"{map.VolcanicActivity[triangleIndex]}, last " +
                    $"{map.VolcanicLastActiveEpoch[triangleIndex]}).");
            }
        }

        if (roots > 0 && (constructed == 0 || active == 0))
        {
            throw new InvalidOperationException("Mantle plumes constructed no volcanic geography.");
        }

        LandscapeSurface.Validate(map);
    }

    private static void PrepareCurrentEpoch(PhysicalGeographyField map, bool preserveHistory)
    {
        map.VolcanicActivity.Clear();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var cleared = preserveHistory ? OwnedActiveFeatures : OwnedActiveFeatures | OwnedHistoricalFeatures;
            map.FeatureFlags[triangleIndex] &= ~cleared;
        }
    }

    /// <summary>
    /// A plume is anchored in the mantle, not in the crust. It wanders a short
    /// way during an epoch, building a local chain of cones, and then returns
    /// home for the next epoch — the displacement is never cumulative.
    ///
    /// The long hotspot track comes from the other direction: between epochs
    /// the plate drifts, so the same mantle anchor sits over different crust
    /// each time, and cones built in earlier epochs have travelled away with
    /// the crust that carries them. Drifting the plume itself instead would
    /// produce a chain that no crust remembers being part of.
    /// </summary>
    private static int AdvanceOverPlume(
        PhysicalGeographyField map,
        int root,
        int sequence,
        PhysicalGeographyGenerationProfile profile)
    {
        var wanderAngle = PhysicalNoise.HashUnit(0x51f3, root, sequence) * Math.PI * 2d;
        var motionX = (int)Math.Round(Math.Cos(wanderAngle) * 1000d, MidpointRounding.AwayFromZero);
        var motionY = (int)Math.Round(Math.Sin(wanderAngle) * 1000d, MidpointRounding.AwayFromZero);
        var reach = PhysicalNoise.HashUnit(0x2c87, root, sequence);
        var steps = (int)Math.Round(
            profile.MantlePlumeDriftPerEpoch * (0.35d + (reach * 0.65d)),
            MidpointRounding.AwayFromZero);
        var current = root;
        for (var step = 0; step < steps; step++)
        {
            var next = NextAlongMotion(map, current, motionX, motionY);
            if (next == current)
            {
                break;
            }

            current = next;
        }

        return current;
    }

    private static int NextAlongMotion(PhysicalGeographyField map, int current, int motionX, int motionY)
    {
        var best = current;
        var bestAlignment = 0d;
        var sourceX = map.Grid.TriangleX(current);
        var sourceY = map.Grid.TriangleY(current);
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(current, edge);
            if (neighbor < 0 || !map.Grid.TriangleIsInsideContentDomain(neighbor))
            {
                continue;
            }

            var alignment = ((map.Grid.TriangleX(neighbor) - sourceX) * motionX) +
                ((map.Grid.TriangleY(neighbor) - sourceY) * motionY);
            if (alignment > bestAlignment)
            {
                best = neighbor;
                bestAlignment = alignment;
            }
        }

        return best;
    }

    private static void ConstructCenter(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int center,
        int strength,
        int recordedEpoch,
        bool caldera)
    {
        var centerX = map.Grid.TriangleX(center);
        var centerY = map.Grid.TriangleY(center);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var dx = map.Grid.TriangleX(triangleIndex) - centerX;
            var dy = map.Grid.TriangleY(triangleIndex) - centerY;
            var distance = Math.Sqrt((dx * dx) + (dy * dy));
            if (distance > profile.MantlePlumeRadius)
            {
                continue;
            }

            ConstructTriangle(
                map,
                profile,
                triangleIndex,
                distance,
                strength,
                recordedEpoch,
                caldera);
        }
    }

    private static void ConstructTriangle(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex,
        double distance,
        int strength,
        int recordedEpoch,
        bool caldera)
    {
        var apronInfluence = Math.Max(0d, 1d - (distance / profile.MantlePlumeRadius));
        var coneInfluence = Math.Max(0d, 1d - (distance / profile.VolcanicConeRadius));
        var crustScale = map.CrustTypeCodes[triangleIndex] == PhysicalCrustTypeCodes.Continental
            ? 0.72d
            : 1d;
        var upliftUnits = ((profile.VolcanicApronHeight * apronInfluence) +
            (profile.VolcanicConeHeight * coneInfluence * coneInfluence)) *
            strength / 1000d * crustScale;
        var uplift = Math.Max(1L, PhysicalElevation.FromUnits(upliftUnits));
        var calderaRadius = profile.VolcanicConeRadius * 0.28d;
        var calderaCut = caldera && distance < calderaRadius
            ? PhysicalElevation.FromUnits(
                profile.VolcanicCalderaDepth *
                (1d - ((distance / calderaRadius) * (distance / calderaRadius))))
            : 0L;
        var maximum = PhysicalElevation.FromUnits(PhysicalCrust.MaximumHeightUnits) - map.SedimentThickness[triangleIndex];
        map.BedrockElevation[triangleIndex] = Math.Clamp(
            checked(map.BedrockElevation[triangleIndex] + uplift - calderaCut),
            PhysicalElevation.FromUnits(PhysicalCrust.MinimumHeightUnits),
            maximum);
        map.SurfaceRockLoad[triangleIndex] = checked(
            map.SurfaceRockLoad[triangleIndex] + uplift - calderaCut);
        map.VolcanicConstructionHistory[triangleIndex] = checked(
            map.VolcanicConstructionHistory[triangleIndex] + uplift);
        LandscapeSurface.Rebuild(map, triangleIndex);

        var activity = (int)Math.Round(strength * apronInfluence, MidpointRounding.AwayFromZero);
        map.VolcanicActivity[triangleIndex] = Math.Max(map.VolcanicActivity[triangleIndex], activity);
        if (activity >= strength / 4)
        {
            map.VolcanicLastActiveEpoch[triangleIndex] = recordedEpoch;
        }

        map.FractureConductance[triangleIndex] = Math.Max(
            map.FractureConductance[triangleIndex],
            activity * 7 / 10);
        map.Uplift[triangleIndex] = Math.Max(
            map.Uplift[triangleIndex],
            (float)Math.Clamp(coneInfluence, 0d, 1d));
        AddPhysicalFeatures(map, triangleIndex, distance, profile, activity, strength, caldera);
    }

    private static void AddPhysicalFeatures(
        PhysicalGeographyField map,
        int triangleIndex,
        double distance,
        PhysicalGeographyGenerationProfile profile,
        int activity,
        int strength,
        bool caldera)
    {
        if (distance <= profile.VolcanicConeRadius)
        {
            map.FeatureFlags[triangleIndex] |= PhysicalGeographyFeatureCodes.VolcanicCone;
        }
        else
        {
            map.FeatureFlags[triangleIndex] |= PhysicalGeographyFeatureCodes.LavaPlain;
        }

        if (caldera && distance <= profile.VolcanicConeRadius * 0.28d)
        {
            map.FeatureFlags[triangleIndex] |= PhysicalGeographyFeatureCodes.VolcanicCaldera;
        }

        if (activity >= Math.Min(600, strength * 3 / 4))
        {
            map.FeatureFlags[triangleIndex] |= PhysicalGeographyFeatureCodes.MantlePlume;
        }
    }

    private static bool StateIsValid(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationContext context)
    {
        var flags = map.FeatureFlags[triangleIndex];
        var maximumEpoch = context.IsEvolutionEpoch ? context.EpochIndex : 0;
        return map.VolcanicActivity[triangleIndex] is >= 0 and <= 1000 &&
            map.VolcanicConstructionHistory[triangleIndex] >= 0 &&
            map.Elevation[triangleIndex] >= PhysicalElevation.FromUnits(PhysicalCrust.MinimumHeightUnits) &&
            map.Elevation[triangleIndex] <= PhysicalElevation.FromUnits(PhysicalCrust.MaximumHeightUnits) &&
            map.VolcanicLastActiveEpoch[triangleIndex] >= -1 &&
            map.VolcanicLastActiveEpoch[triangleIndex] <= maximumEpoch &&
            HistoricalFeaturesAreValid(map, triangleIndex, flags) &&
            ActiveFeaturesAreValid(map, triangleIndex, flags);
    }

    private static bool HistoricalFeaturesAreValid(
        PhysicalGeographyField map,
        int triangleIndex,
        int flags) =>
        ((flags & OwnedHistoricalFeatures) == 0 ||
            map.VolcanicConstructionHistory[triangleIndex] > 0) &&
        ((flags & PhysicalGeographyFeatureCodes.VolcanicCaldera) == 0 ||
            (flags & PhysicalGeographyFeatureCodes.VolcanicCone) != 0);

    private static bool ActiveFeaturesAreValid(
        PhysicalGeographyField map,
        int triangleIndex,
        int flags) =>
        (flags & PhysicalGeographyFeatureCodes.MantlePlume) == 0 ||
        map.VolcanicActivity[triangleIndex] > 0;
}
