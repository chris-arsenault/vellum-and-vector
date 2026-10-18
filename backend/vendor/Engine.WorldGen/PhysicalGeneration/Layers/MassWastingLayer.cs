namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Moves unstable rock and sediment downslope while conserving local material.
/// Resistant rock supports steeper faces; weak material fails at gentler slopes.
/// Regional rebound from the resulting load transfer is handled separately by
/// crustal support and lithospheric flexure.
/// </summary>
internal sealed class MassWastingLayer(bool postFluvial = false) : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        postFluvial ? "post-fluvial-mass-wasting" : "mass-wasting",
        0,
        PhysicalGeographyFacts.Elevation | PhysicalGeographyFacts.LandscapeHistory,
        PhysicalGeographyFacts.Elevation,
        PhysicalGeographyFacts.CrustalSupport |
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
        var cuts = new long[map.Grid.TriangleCount];
        var fills = new long[map.Grid.TriangleCount];
        var iterations = postFluvial
            ? context.Profile.PostFluvialMassWastingIterations
            : context.Profile.MassWastingIterations;
        for (var iteration = 0; iteration < iterations; iteration++)
        {
            Array.Clear(cuts);
            Array.Clear(fills);
            MeasureTransfers(map, context.Profile, cuts, fills);
            ApplyTransfers(map, cuts, fills);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        LandscapeSurface.Validate(map);
    }

    private static void MeasureTransfers(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        long[] cuts,
        long[] fills)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            MeasureSourceTransfers(map, profile, cuts, fills, triangleIndex);
        }
    }

    private static void MeasureSourceTransfers(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        long[] cuts,
        long[] fills,
        int triangleIndex)
    {
        var stableStep = StableStep(map, profile, triangleIndex);

        Span<int> neighbors = stackalloc int[3];
        Span<long> requested = stackalloc long[3];
        var count = 0;
        long requestedTotal = 0;
        var maximumExcess = 0d;
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
            if (neighbor < 0)
            {
                continue;
            }

            var difference = PhysicalElevation.ToUnits(
                map.Elevation[triangleIndex] - map.Elevation[neighbor]);
            var excess = difference - stableStep;
            if (excess <= 0d)
            {
                continue;
            }

            var transfer = PhysicalElevation.FromUnits(Math.Min(
                profile.MaximumMassWastingTransportPerPass,
                excess * profile.MassWastingTransportFraction / 1000d));
            if (transfer <= 0)
            {
                continue;
            }

            neighbors[count] = neighbor;
            requested[count] = transfer;
            requestedTotal = checked(requestedTotal + transfer);
            maximumExcess = Math.Max(maximumExcess, excess);
            count++;
        }

        if (count == 0 || requestedTotal <= 0)
        {
            return;
        }

        var sourceBudget = PhysicalElevation.FromUnits(Math.Min(
            profile.MaximumMassWastingTransportPerPass,
            maximumExcess * profile.MassWastingTransportFraction / 1000d));
        sourceBudget = Math.Min(sourceBudget, requestedTotal);
        AllocateSourceBudget(
            cuts,
            fills,
            triangleIndex,
            neighbors[..count],
            requested[..count],
            requestedTotal,
            sourceBudget);
    }

    private static double StableStep(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex)
    {
        var resistance = map.RockResistance[triangleIndex] /
            (double)Math.Max(1, PhysicalRock.BaselineResistance);
        return profile.MassWastingStableStep * Math.Clamp(
            0.55d + (resistance * 0.45d), 0.55d, 1.45d);
    }

    private static void AllocateSourceBudget(
        long[] cuts,
        long[] fills,
        int triangleIndex,
        ReadOnlySpan<int> neighbors,
        ReadOnlySpan<long> requested,
        long requestedTotal,
        long sourceBudget)
    {
        var remaining = sourceBudget;
        var remainingRequested = requestedTotal;
        for (var index = 0; index < requested.Length; index++)
        {
            var transfer = index == requested.Length - 1
                ? remaining
                : Math.Min(
                    requested[index],
                    checked(remaining * requested[index] / remainingRequested));
            remaining -= transfer;
            remainingRequested -= requested[index];
            cuts[triangleIndex] = checked(cuts[triangleIndex] + transfer);
            fills[neighbors[index]] = checked(fills[neighbors[index]] + transfer);
        }
    }

    private static void ApplyTransfers(
        PhysicalGeographyField map,
        ReadOnlySpan<long> cuts,
        ReadOnlySpan<long> fills)
    {
        long transported = 0;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (cuts[triangleIndex] > 0)
            {
                _ = LandscapeSurface.Erode(map, triangleIndex, cuts[triangleIndex]);
                transported = checked(transported + cuts[triangleIndex]);
            }

            if (fills[triangleIndex] > 0)
            {
                _ = LandscapeSurface.Deposit(map, triangleIndex, fills[triangleIndex]);
            }
        }

        map.SedimentProducedTotal = checked(map.SedimentProducedTotal + transported);
    }
}
