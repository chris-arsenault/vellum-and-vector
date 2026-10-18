namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class GlacialDepositionLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "glacial-deposition",
        0,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.LandscapeHistory |
        PhysicalGeographyFacts.SedimentSupply |
        PhysicalGeographyFacts.GlacialEvolution |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.IceFlow,
        PhysicalGeographyFacts.Elevation | PhysicalGeographyFacts.GlacialEvolution,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
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
        PhysicalGeographyFacts.GlacialMeltwater |
        PhysicalGeographyFacts.SeaIce |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var moving = new long[map.Grid.TriangleCount];
        foreach (var triangleIndex in IceSourceToTerminusOrder(map))
        {
            var load = moving[triangleIndex] + map.SedimentSupply[triangleIndex];
            map.SedimentSupply[triangleIndex] = 0;
            if (load <= 0)
            {
                continue;
            }

            var target = map.IceFlowTargets[triangleIndex];
            var deposited = IsTerminus(map, triangleIndex, target, context.Profile)
                ? LandscapeSurface.Deposit(
                    map,
                    triangleIndex,
                    Math.Min(
                        PhysicalElevation.FromUnits(
                            context.Profile.MaximumGlacialDepositionPerPass *
                                context.GlaciationStrength / 1000d),
                        load))
                : 0;
            if (deposited > 0)
            {
                GlacierSurface.RefreshGrounding(map, context.Profile, triangleIndex);
            }
            map.CumulativeGlacialDeposition[triangleIndex] = checked(
                map.CumulativeGlacialDeposition[triangleIndex] + deposited);
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
            throw new InvalidOperationException("Glacial deposition did not conserve sediment.");
        }

        foreach (var value in map.SedimentSupply)
        {
            if (value != 0)
            {
                throw new InvalidOperationException("Glacial deposition did not conserve sediment.");
            }
        }
    }

    private static int[] IceSourceToTerminusOrder(PhysicalGeographyField map)
    {
        var incoming = new int[map.Grid.TriangleCount];
        for (var triangleIndex = 0; triangleIndex < incoming.Length; triangleIndex++)
        {
            var target = map.IceFlowTargets[triangleIndex];
            if (target >= 0)
            {
                incoming[target]++;
            }
        }

        var queue = new Queue<int>();
        for (var triangleIndex = 0; triangleIndex < incoming.Length; triangleIndex++)
        {
            if (incoming[triangleIndex] == 0)
            {
                queue.Enqueue(triangleIndex);
            }
        }

        var result = new int[incoming.Length];
        var count = 0;
        while (queue.TryDequeue(out var triangleIndex))
        {
            result[count++] = triangleIndex;
            var target = map.IceFlowTargets[triangleIndex];
            if (target >= 0 && --incoming[target] == 0)
            {
                queue.Enqueue(target);
            }
        }

        return count == result.Length
            ? result
            : throw new InvalidOperationException("Ice-flow sediment graph contains a cycle.");
    }

    private static bool IsTerminus(
        PhysicalGeographyField map,
        int triangleIndex,
        int target,
        PhysicalGeographyGenerationProfile profile) =>
        map.GroundedIce[triangleIndex] != 0 &&
        (target < 0 || map.GroundedIce[target] == 0 ||
            map.IceFlux[target] < profile.GlacierFluxThreshold / 3 ||
            map.IceFlux[triangleIndex] >= profile.GlacierFluxThreshold &&
                map.IceThickness[target] == 0);
}
