namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Spreads local Airy support across the uniform microtriangle metric and then
/// moves the regional bedrock datum without erasing local surface relief.
/// </summary>
internal sealed class LithosphericFlexureLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "lithospheric-flexure",
        0,
        PhysicalGeographyFacts.CrustalSupport |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.LandscapeHistory,
        PhysicalGeographyFacts.CrustalSupport | PhysicalGeographyFacts.Elevation,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.OceanDistance |
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
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.RiverGeometry |
        PhysicalGeographyFacts.Floodplains |
        PhysicalGeographyFacts.Deltas |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var flexed = FlexSupport(map, context.Profile);
        var initialize = !map.CrustSupportInitialized;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (initialize)
            {
                map.CrustSupportElevation[triangleIndex] = flexed[triangleIndex];
                continue;
            }

            ApplySupportShift(map, triangleIndex, flexed[triangleIndex]);
        }

        map.CrustSupportInitialized = true;
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        LandscapeSurface.Validate(map);
        var minimum = PhysicalElevation.FromUnits(PhysicalCrust.MinimumHeightUnits);
        var maximum = PhysicalElevation.FromUnits(PhysicalCrust.MaximumHeightUnits);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.CrustSupportElevation[triangleIndex] < minimum ||
                map.CrustSupportElevation[triangleIndex] > maximum)
            {
                throw new InvalidOperationException("Flexed crustal support is outside its physical range.");
            }
        }
    }

    private static long[] FlexSupport(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile)
    {
        var current = map.CrustSupportTarget.ToArray();
        var next = new long[current.Length];
        for (var iteration = 0; iteration < profile.LithosphericFlexureIterations; iteration++)
        {
            for (var triangleIndex = 0; triangleIndex < current.Length; triangleIndex++)
            {
                next[triangleIndex] = RelaxTriangle(
                    map.Grid,
                    current,
                    triangleIndex,
                    profile.LithosphericFlexureRelaxationPerMille);
            }

            (current, next) = (next, current);
        }

        return current;
    }

    private static long RelaxTriangle(
        PhysicalGeographyGrid grid,
        ReadOnlySpan<long> current,
        int triangleIndex,
        int relaxationPerMille)
    {
        long neighborTotal = 0;
        var neighborCount = 0;
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = grid.NeighborTriangleIndex(triangleIndex, edge);
            if (neighbor >= 0)
            {
                neighborTotal = checked(neighborTotal + current[neighbor]);
                neighborCount++;
            }
        }

        if (neighborCount == 0)
        {
            return current[triangleIndex];
        }

        var average = neighborTotal / neighborCount;
        return checked(current[triangleIndex] +
            ((average - current[triangleIndex]) * relaxationPerMille / 1000));
    }

    private static void ApplySupportShift(
        PhysicalGeographyField map,
        int triangleIndex,
        long desiredSupport)
    {
        var oldSupport = map.CrustSupportElevation[triangleIndex];
        var shift = desiredSupport - oldSupport;
        var minimum = PhysicalElevation.FromUnits(PhysicalCrust.MinimumHeightUnits);
        var maximum = PhysicalElevation.FromUnits(PhysicalCrust.MaximumHeightUnits) -
            map.SedimentThickness[triangleIndex];
        var nextBedrock = Math.Clamp(
            checked(map.BedrockElevation[triangleIndex] + shift),
            minimum,
            maximum);
        var applied = nextBedrock - map.BedrockElevation[triangleIndex];
        map.BedrockElevation[triangleIndex] = nextBedrock;
        map.CrustSupportElevation[triangleIndex] = checked(oldSupport + applied);
        LandscapeSurface.Rebuild(map, triangleIndex);
    }
}
