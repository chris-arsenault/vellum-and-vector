namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class LandIceLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "land-ice-mass-balance",
        0,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.Moisture |
        PhysicalGeographyFacts.Precipitation |
        PhysicalGeographyFacts.Geothermal |
        PhysicalGeographyFacts.Lakes,
        PhysicalGeographyFacts.LandIce,
        PhysicalGeographyFacts.IceFlow |
        PhysicalGeographyFacts.GlacialMeltwater |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.IceBalance.Clear();
        var land = new List<int>();
        var balances = new List<int>();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (!GlacierSurface.CanCarryLandIce(map, triangleIndex))
            {
                map.IceThickness[triangleIndex] = 0;
                continue;
            }

            var balance = MassBalance(map, triangleIndex, context.Profile);
            map.IceBalance[triangleIndex] = balance;
            if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.None &&
                map.Grid.TriangleIsInsideContentDomain(triangleIndex))
            {
                land.Add(triangleIndex);
                balances.Add(balance);
            }
        }

        var targetCount = Math.Clamp(
            (int)Math.Round(
                land.Count * context.Profile.QualityTargets.LandIceCoverage.Target *
                    context.GlaciationStrength / 1000d,
                MidpointRounding.AwayFromZero),
            0,
            land.Count);
        var cutoff = targetCount == 0
            ? int.MaxValue
            : Math.Max(
                context.Profile.MinimumIceBalance,
                IntegerOrderStatistics.ValueAtDescendingRank(
                    System.Runtime.InteropServices.CollectionsMarshal.AsSpan(balances),
                    targetCount - 1));
        ApplyDryLandBalance(map, context, cutoff);
        AdvanceOntoFrozenLakes(map, context);
    }

    private static void ApplyDryLandBalance(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int cutoff)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var balance = map.IceBalance[triangleIndex];
            if (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.None)
            {
                continue;
            }

            map.IceThickness[triangleIndex] = balance >= cutoff
                ? AccumulateIce(
                    map.IceThickness[triangleIndex],
                    balance - cutoff,
                    context.Profile,
                    context.GlaciationStrength)
                : Math.Max(0, map.IceThickness[triangleIndex] - context.Profile.IceAblationStep);
            map.MaximumIceThickness[triangleIndex] = Math.Max(
                map.MaximumIceThickness[triangleIndex],
                map.IceThickness[triangleIndex]);
        }
    }

    private static void AdvanceOntoFrozenLakes(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context)
    {
        var reached = new bool[map.Grid.TriangleCount];
        var queue = new Queue<int>();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Lake)
            {
                map.IceThickness[triangleIndex] = Math.Max(
                    0,
                    map.IceThickness[triangleIndex] - context.Profile.IceAblationStep);
            }
            else if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.None &&
                map.IceThickness[triangleIndex] > 0)
            {
                reached[triangleIndex] = true;
                queue.Enqueue(triangleIndex);
            }
        }

        while (queue.TryDequeue(out var source))
        {
            AdvanceFromSource(map, context, reached, queue, source);
        }

        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Lake)
            {
                map.MaximumIceThickness[triangleIndex] = Math.Max(
                    map.MaximumIceThickness[triangleIndex],
                    map.IceThickness[triangleIndex]);
            }
        }
    }

    private static void AdvanceFromSource(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        bool[] reached,
        Queue<int> queue,
        int source)
    {
        for (var edge = 0; edge < 3; edge++)
        {
            var target = map.Grid.NeighborTriangleIndex(source, edge);
            if (target < 0 || map.WaterKindCodes[target] != PhysicalWaterKindCodes.Lake ||
                !LakeCanFreeze(map, target, context))
            {
                continue;
            }

            var candidate = Math.Max(
                0,
                map.IceThickness[source] - context.Profile.FrozenLakeIceAdvanceDecay);
            var improved = candidate > map.IceThickness[target];
            if (improved)
            {
                map.IceThickness[target] = candidate;
            }

            if (!reached[target] || improved)
            {
                reached[target] = true;
                queue.Enqueue(target);
            }
        }
    }

    private static bool LakeCanFreeze(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationContext context) =>
        context.GlaciationStrength > 0 &&
        map.Temperature[triangleIndex] <= context.Profile.IceTemperatureThreshold &&
        map.IceBalance[triangleIndex] >= context.Profile.MinimumIceBalance;

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.IceThickness[triangleIndex] > 0 &&
                !GlacierSurface.CanCarryLandIce(map, triangleIndex))
            {
                throw new InvalidOperationException("Land glacier was assigned outside land or inland water.");
            }
        }
    }

    private static int MassBalance(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile)
    {
        var cold = Math.Max(0, profile.IceTemperatureThreshold - map.Temperature[triangleIndex]);
        var snowfall = map.Snowfall[triangleIndex] * cold / 300;
        var altitude = PhysicalElevation.ToUnits(Math.Max(
            0L,
            GlacierSurface.SupportElevation(map, triangleIndex) - map.EffectiveSeaLevel)) / 4;
        var concavity = LocalConcavity(map, triangleIndex);
        var warmAblation = Math.Max(0, map.Temperature[triangleIndex] - profile.IceTemperatureThreshold) * 4;
        var geothermalAblation = map.Geothermal[triangleIndex] / 3;
        var dryAblation = Math.Max(0, 280 - map.Moisture[triangleIndex]);
        return (cold * 2) + snowfall + altitude + concavity -
            warmAblation - geothermalAblation - dryAblation;
    }

    private static int AccumulateIce(
        int current,
        int balanceAboveCutoff,
        PhysicalGeographyGenerationProfile profile,
        int glaciationStrength)
    {
        var growth = Math.Min(
            profile.IceAccumulationStep,
            profile.GlacierThicknessThreshold + (balanceAboveCutoff * 2)) *
            glaciationStrength / 1000;
        return Math.Clamp(current + growth, profile.GlacierThicknessThreshold, 1000);
    }

    private static int LocalConcavity(PhysicalGeographyField map, int triangleIndex)
    {
        var total = 0L;
        var count = 0;
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
            if (neighbor >= 0)
            {
                total += GlacierSurface.SupportElevation(map, neighbor) -
                    GlacierSurface.SupportElevation(map, triangleIndex);
                count++;
            }
        }

        return count == 0
            ? 0
            : PhysicalElevation.ToUnits(Math.Max(0L, total / count)) * 2;
    }
}
