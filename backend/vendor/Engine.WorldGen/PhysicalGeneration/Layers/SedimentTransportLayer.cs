namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class SedimentTransportLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "sediment-transport",
        0,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.SedimentSupply |
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.FlowRouting |
        PhysicalGeographyFacts.Rivers,
        PhysicalGeographyFacts.Elevation | PhysicalGeographyFacts.SedimentTransport,
        // Preserve the epoch's forcing fields until glaciation has consumed
        // them; glacial evolution invalidates them before reconciliation.
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.IceFlow |
        PhysicalGeographyFacts.SeaIce |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.CoastalEvolution |
        PhysicalGeographyFacts.GlacialEvolution |
        PhysicalGeographyFacts.RiverGeometry |
        PhysicalGeographyFacts.Floodplains |
        PhysicalGeographyFacts.Deltas |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var moving = new long[map.Grid.TriangleCount];
        var sourceToOutlet = FlowGraphAlgorithms.SourceToOutletOrder(map);
        foreach (var triangleIndex in sourceToOutlet)
        {
            var load = moving[triangleIndex] + map.SedimentSupply[triangleIndex];
            map.SedimentSupply[triangleIndex] = 0;
            if (load <= 0)
            {
                continue;
            }

            var target = map.FlowTargets[triangleIndex];
            var deposited = DepositAtTriangle(map, context.Profile, triangleIndex, target, load);
            var remaining = load - deposited;
            if (target >= 0)
            {
                moving[target] = checked(moving[target] + remaining);
            }
            else
            {
                map.SedimentExportedTotal = checked(map.SedimentExportedTotal + remaining);
            }
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        LandscapeSurface.Validate(map);
        if (map.SedimentDepositedTotal + map.SedimentExportedTotal != map.SedimentProducedTotal)
        {
            throw new InvalidOperationException("Sediment transport did not conserve its supplied load.");
        }

        foreach (var value in map.SedimentSupply)
        {
            if (value != 0)
            {
                throw new InvalidOperationException("Sediment transport did not conserve its supplied load.");
            }
        }
    }

    private static long DepositAtTriangle(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex,
        int target,
        long load)
    {
        if (!ShouldDeposit(map, profile, triangleIndex, target))
        {
            return 0;
        }

        var requested = Math.Min(
            PhysicalElevation.FromUnits(profile.MaximumSedimentDepositionPerPass),
            Math.Max(1L, PhysicalElevation.Multiply(load, profile.SedimentTransportFraction, 1000)));
        return LandscapeSurface.Deposit(map, triangleIndex, requested);
    }

    private static bool ShouldDeposit(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex,
        int target) =>
        map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Lake ||
        map.Slope[triangleIndex] <= PhysicalElevation.FromUnits(profile.SedimentDepositionSlopeThreshold) ||
        target >= 0 && map.WaterKindCodes[target] == PhysicalWaterKindCodes.Ocean;
}
