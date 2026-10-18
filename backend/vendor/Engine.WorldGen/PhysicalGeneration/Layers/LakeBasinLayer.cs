namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Discovers topographic accommodation from the priority-flood surface, then
/// solves actual standing water from catchment supply and open-water losses.
/// The routing fill is a spill datum, never an instruction to fill a basin.
/// </summary>
internal sealed class LakeBasinLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "lake-basins",
        0x7a31,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.Precipitation |
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.DrainageConditioning,
        PhysicalGeographyFacts.Lakes,
        PhysicalGeographyFacts.DrainageGuidance |
        PhysicalGeographyFacts.FlowRouting |
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.IceFlow |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        ClearPreviousLakes(map);
        var contributingWater = AccumulateContributingWater(map);
        var depression = BuildDepressionMask(map);
        var componentMarks = new int[map.Grid.TriangleCount];
        var nextComponentId = 0;
        var supported = new List<SupportedLake>();
        for (var triangleIndex = 0; triangleIndex < depression.Length; triangleIndex++)
        {
            if (!depression[triangleIndex] || componentMarks[triangleIndex] != 0)
            {
                continue;
            }

            var componentId = ++nextComponentId;
            foreach (var component in CollectComponents(
                map,
                depression,
                componentMarks,
                triangleIndex,
                componentId))
            {
                AddSupportedPools(map, context.Profile, component, contributingWater, supported);
            }
        }

        var nextBodyId = 1;
        foreach (var lake in supported.OrderBy(candidate => candidate.Members[0]))
        {
            MarkLakeBody(map, context, lake, componentMarks, ++nextBodyId);
        }
    }

    private static void AddSupportedPools(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        DepressionComponent component,
        long[] contributingWater,
        List<SupportedLake> supported)
    {
        var lake = SolveSupportedStage(map, profile, component, contributingWater);
        if (lake is null)
        {
            return;
        }

        foreach (var pool in SplitSupportedPools(map, lake))
        {
            if (Qualifies(map, pool, profile))
            {
                supported.Add(pool);
            }
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var surfaces = new Dictionary<int, long>();
        var counts = new Dictionary<int, int>();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            ValidateOverflow(map, triangleIndex);
            ValidateLakeTriangle(map, triangleIndex, surfaces, counts);
        }

        if (counts.Values.Any(count => count < context.Profile.MinimumLakeTriangles))
        {
            throw new InvalidOperationException("Lake body is smaller than its configured minimum.");
        }
    }

    private static void ValidateOverflow(PhysicalGeographyField map, int triangleIndex)
    {
        var overflow = map.LakeOverflow[triangleIndex];
        if (overflow < 0 || overflow > 0 &&
            (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.Lake ||
                map.LakeOutletTargets[triangleIndex] < 0))
        {
            throw new InvalidOperationException("Lake overflow lacks a physical outlet.");
        }
    }

    private static void ValidateLakeTriangle(
        PhysicalGeographyField map,
        int triangleIndex,
        Dictionary<int, long> surfaces,
        Dictionary<int, int> counts)
    {
        if (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.Lake)
        {
            return;
        }

        var bodyId = map.WaterBodyIds[triangleIndex];
        var surface = map.WaterSurfaceElevations[triangleIndex];
        if (bodyId <= 1 || map.WaterDepths[triangleIndex] <= 0 ||
            surface - map.Elevation[triangleIndex] != map.WaterDepths[triangleIndex] ||
            (!surfaces.TryAdd(bodyId, surface) && surfaces[bodyId] != surface))
        {
            throw new InvalidOperationException("Lake body has inconsistent depth or surface data.");
        }

        counts[bodyId] = counts.GetValueOrDefault(bodyId) + 1;
    }

    private static void ClearPreviousLakes(PhysicalGeographyField map)
    {
        map.LakeOutletTargets.Fill(-1);
        map.LakeOverflow.Clear();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Lake)
            {
                map.WaterKindCodes[triangleIndex] = PhysicalWaterKindCodes.None;
                map.WaterBodyIds[triangleIndex] = 0;
                map.ClearWaterSurface(triangleIndex);
            }
        }
    }

    private static long[] AccumulateContributingWater(PhysicalGeographyField map)
    {
        var count = map.Grid.TriangleCount;
        var rankOrder = new int[count];
        Array.Fill(rankOrder, -1);
        var accumulated = new long[count];
        for (var triangleIndex = 0; triangleIndex < count; triangleIndex++)
        {
            var rank = map.DrainageRanks[triangleIndex];
            if (rank is < 0 || rank >= count || rankOrder[rank] >= 0)
            {
                throw new InvalidOperationException("Priority-flood ranks are not a complete order.");
            }

            rankOrder[rank] = triangleIndex;
            accumulated[triangleIndex] = map.Runoff[triangleIndex];
        }

        for (var rank = count - 1; rank >= 0; rank--)
        {
            var triangleIndex = rankOrder[rank];
            var parent = map.DrainageParents[triangleIndex];
            if (parent >= 0)
            {
                accumulated[parent] = SaturatingAdd(
                    accumulated[parent],
                    accumulated[triangleIndex]);
            }
        }

        return accumulated;
    }

    private static long SaturatingAdd(long first, long second) =>
        first > long.MaxValue - second ? long.MaxValue : first + second;

    /// <summary>
    /// The conditioned surface carries a subunit epsilon gradient, so a cell
    /// counts as accommodation only when the fill exceeds its floor by at least
    /// a full elevation unit; epsilon-raised routing cells stay dry land.
    /// </summary>
    private const long MinimumSubmergence = PhysicalElevation.SubunitsPerUnit;

    private static bool[] BuildDepressionMask(PhysicalGeographyField map)
    {
        var depression = new bool[map.Grid.TriangleCount];
        for (var triangleIndex = 0; triangleIndex < depression.Length; triangleIndex++)
        {
            depression[triangleIndex] = map.WaterKindCodes[triangleIndex] ==
                    PhysicalWaterKindCodes.None &&
                map.DrainageElevations[triangleIndex] - map.Elevation[triangleIndex] >=
                    MinimumSubmergence;
        }

        return depression;
    }

    private static List<DepressionComponent> CollectComponents(
        PhysicalGeographyField map,
        bool[] depression,
        int[] componentMarks,
        int start,
        int componentId)
    {
        var queue = new Queue<int>();
        var collected = new List<int>();
        var spillSurface = long.MaxValue;
        componentMarks[start] = componentId;
        queue.Enqueue(start);
        while (queue.TryDequeue(out var member))
        {
            collected.Add(member);
            spillSurface = Math.Min(spillSurface, map.DrainageElevations[member]);
            EnqueueComponentNeighbors(map, depression, componentMarks, queue, member, componentId);
        }

        var submerged = new HashSet<int>();
        foreach (var member in collected)
        {
            if (spillSurface > map.Elevation[member])
            {
                submerged.Add(member);
            }
        }

        return SplitSubmergedLobes(map, submerged, spillSurface, componentId);
    }

    private static List<DepressionComponent> SplitSubmergedLobes(
        PhysicalGeographyField map,
        HashSet<int> submerged,
        long spillSurface,
        int componentId)
    {
        var lobes = new List<DepressionComponent>();
        var visited = new HashSet<int>();
        foreach (var start in submerged)
        {
            if (!visited.Add(start))
            {
                continue;
            }

            var members = new List<int>();
            var queue = new Queue<int>();
            queue.Enqueue(start);
            while (queue.TryDequeue(out var member))
            {
                members.Add(member);
                for (var edge = 0; edge < 3; edge++)
                {
                    var neighbor = map.Grid.NeighborTriangleIndex(member, edge);
                    if (neighbor >= 0 && submerged.Contains(neighbor) && visited.Add(neighbor))
                    {
                        queue.Enqueue(neighbor);
                    }
                }
            }

            members.Sort();
            lobes.Add(new DepressionComponent(componentId, members, spillSurface));
        }

        return lobes;
    }

    private static void EnqueueComponentNeighbors(
        PhysicalGeographyField map,
        bool[] depression,
        int[] componentMarks,
        Queue<int> queue,
        int member,
        int componentId)
    {
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(member, edge);
            if (neighbor >= 0 && depression[neighbor] && componentMarks[neighbor] == 0)
            {
                componentMarks[neighbor] = componentId;
                queue.Enqueue(neighbor);
            }
        }
    }

    private static SupportedLake? SolveSupportedStage(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        DepressionComponent component,
        long[] contributingWater)
    {
        if (component.Members.Count == 0)
        {
            return null;
        }

        var cells = BuildBasinCells(map, profile, component);
        var input = component.Members.Max(member => contributingWater[member]);
        var budget = SolveStageBudget(cells, input);
        return BuildSupportedLake(map, component, cells, input, budget);
    }

    private static BasinCell[] BuildBasinCells(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        DepressionComponent component) =>
        component.Members
            .Select(member => new BasinCell(
                member,
                map.Elevation[member],
                OpenWaterLoss(map, profile, member),
                DirectWaterInput(map, profile, member) - map.Runoff[member]))
            .OrderBy(cell => cell.Floor)
            .ThenBy(cell => cell.TriangleIndex)
            .ToArray();

    private static StageBudget SolveStageBudget(BasinCell[] cells, long input)
    {
        var loss = 0L;
        var directAdjustment = 0L;
        var supportedCount = 0;
        var cursor = 0;
        while (cursor < cells.Length)
        {
            var groupFloor = cells[cursor].Floor;
            var groupEnd = cursor;
            var groupLoss = 0L;
            var groupAdjustment = 0L;
            while (groupEnd < cells.Length && cells[groupEnd].Floor == groupFloor)
            {
                groupLoss = SaturatingAdd(groupLoss, cells[groupEnd].WaterLoss);
                groupAdjustment += cells[groupEnd].DirectInputAdjustment;
                groupEnd++;
            }

            var nextLoss = SaturatingAdd(loss, groupLoss);
            var nextAdjustment = directAdjustment + groupAdjustment;
            if (nextLoss > Math.Max(0L, input + nextAdjustment))
            {
                break;
            }

            loss = nextLoss;
            directAdjustment = nextAdjustment;
            supportedCount = groupEnd;
            cursor = groupEnd;
        }

        return new StageBudget(supportedCount, loss, directAdjustment);
    }

    private static SupportedLake? BuildSupportedLake(
        PhysicalGeographyField map,
        DepressionComponent component,
        BasinCell[] cells,
        long input,
        StageBudget budget)
    {
        if (budget.SupportedCount == 0)
        {
            return null;
        }

        var surface = budget.SupportedCount == cells.Length
            ? component.SpillSurface
            : Math.Min(component.SpillSurface, cells[budget.SupportedCount].Floor);
        var members = cells
            .Take(budget.SupportedCount)
            .Where(cell => cell.Floor < surface)
            .Select(cell => cell.TriangleIndex)
            .Order()
            .ToList();
        if (members.Count == 0)
        {
            return null;
        }

        var maximumDepth = members.Max(member => surface - map.Elevation[member]);
        var availableInput = Math.Max(0L, input + budget.DirectAdjustment);
        var overflow = budget.SupportedCount == cells.Length
            ? Math.Max(0L, availableInput - budget.Loss)
            : 0L;
        return new SupportedLake(
            component,
            members,
            surface,
            maximumDepth,
            overflow);
    }

    /// <summary>
    /// A water budget can stop below an internal saddle. At that stage the
    /// submerged cells on either side are independent lakes, not one
    /// disconnected water body. A component filled to its spill surface is
    /// connected by construction and retains its single overflow outlet.
    /// </summary>
    private static List<SupportedLake> SplitSupportedPools(
        PhysicalGeographyField map,
        SupportedLake lake)
    {
        var remaining = new HashSet<int>(lake.Members);
        var pools = new List<SupportedLake>();
        while (remaining.Count > 0)
        {
            var start = remaining.Min();
            var members = new List<int>();
            var queue = new Queue<int>();
            remaining.Remove(start);
            queue.Enqueue(start);
            while (queue.TryDequeue(out var member))
            {
                members.Add(member);
                for (var edge = 0; edge < 3; edge++)
                {
                    var neighbor = map.Grid.NeighborTriangleIndex(member, edge);
                    if (neighbor >= 0 && remaining.Remove(neighbor))
                    {
                        queue.Enqueue(neighbor);
                    }
                }
            }

            members.Sort();
            pools.Add(new SupportedLake(
                lake.Component,
                members,
                lake.Surface,
                members.Max(member => lake.Surface - map.Elevation[member]),
                lake.Members.Count == members.Count ? lake.Overflow : 0L));
        }

        return pools;
    }

    private static int DirectWaterInput(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex)
    {
        var snowMelt = Math.Clamp(
            (map.Temperature[triangleIndex] -
                (profile.SnowTemperatureThreshold - profile.SnowTemperatureTransition)) *
            1000 / profile.SnowTemperatureTransition,
            0,
            1000);
        return Math.Clamp(
            map.Rainfall[triangleIndex] +
                (map.Snowfall[triangleIndex] * snowMelt / 1000),
            0,
            1000);
    }

    private static long OpenWaterLoss(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex) =>
        profile.LakeEvaporationMinimum +
        (map.Temperature[triangleIndex] *
            profile.LakeEvaporationTemperatureStrength / 1000L) +
        profile.LakeInfiltrationLoss;

    private static bool Qualifies(
        PhysicalGeographyField map,
        SupportedLake lake,
        PhysicalGeographyGenerationProfile profile) =>
        lake.Members.Count >= profile.MinimumLakeTriangles &&
        lake.MaximumDepth >= PhysicalElevation.FromUnits(profile.LakeDepthThreshold) &&
        IsCompact(map, lake.Members, profile);

    private static bool IsCompact(
        PhysicalGeographyField map,
        List<int> members,
        PhysicalGeographyGenerationProfile profile)
    {
        var memberSet = new HashSet<int>(members);
        var interior = 0;
        foreach (var member in members)
        {
            var lakeNeighbors = 0;
            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = map.Grid.NeighborTriangleIndex(member, edge);
                if (neighbor >= 0 && memberSet.Contains(neighbor))
                {
                    lakeNeighbors++;
                }
            }

            if (lakeNeighbors >= 2)
            {
                interior++;
            }
        }

        return interior * 1000L >= (long)members.Count * profile.LakeCompactnessShare;
    }

    private static void MarkLakeBody(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        SupportedLake lake,
        int[] componentMarks,
        int bodyId)
    {
        foreach (var member in lake.Members)
        {
            map.WaterKindCodes[member] = PhysicalWaterKindCodes.Lake;
            map.WaterBodyIds[member] = bodyId;
            map.SetWaterSurface(member, lake.Surface);
        }

        if (lake.Overflow <= 0 || lake.Surface < lake.Component.SpillSurface)
        {
            return;
        }

        var outlet = FindOutlet(
            map,
            lake.Component.Members,
            componentMarks,
            lake.Component.ComponentId,
            lake.Component.SpillSurface,
            context.Seed);
        if (outlet.Member >= 0)
        {
            map.LakeOutletTargets[outlet.Member] = outlet.Target;
            map.LakeOverflow[outlet.Member] = lake.Overflow;
        }
    }

    private static (int Member, int Target) FindOutlet(
        PhysicalGeographyField map,
        IReadOnlyList<int> members,
        int[] componentMarks,
        int componentId,
        long surface,
        int seed)
    {
        var best = OutletCandidate.Invalid;
        foreach (var member in members)
        {
            var candidate = FindMemberOutlet(
                map,
                componentMarks,
                componentId,
                surface,
                seed,
                member);
            if (IsPreferred(candidate, best))
            {
                best = candidate;
            }
        }

        return (best.Member, best.Target);
    }

    private static OutletCandidate FindMemberOutlet(
        PhysicalGeographyField map,
        int[] componentMarks,
        int componentId,
        long surface,
        int seed,
        int member)
    {
        var target = map.DrainageParents[member];
        if (!CanBeOutlet(map, componentMarks, componentId, surface, target))
        {
            return OutletCandidate.Invalid;
        }

        var drainage = map.WaterKindCodes[target] == PhysicalWaterKindCodes.Ocean
            ? long.MinValue
            : map.DrainageElevations[target];
        return new OutletCandidate(
            member,
            target,
            map.DrainageRanks[member],
            drainage,
            GeometryKey(map, seed, member, target));
    }

    private static bool IsPreferred(OutletCandidate candidate, OutletCandidate best) =>
        candidate.Member >= 0 &&
        (candidate.Rank < best.Rank ||
            candidate.Rank == best.Rank && candidate.Drainage < best.Drainage ||
            candidate.Rank == best.Rank && candidate.Drainage == best.Drainage &&
                candidate.Geometry > best.Geometry);

    private static double GeometryKey(
        PhysicalGeographyField map,
        int seed,
        int member,
        int target)
    {
        var x = (int)Math.Round(
            (map.Grid.TriangleX(member) + map.Grid.TriangleX(target)) * 512d,
            MidpointRounding.AwayFromZero);
        var y = (int)Math.Round(
            (map.Grid.TriangleY(member) + map.Grid.TriangleY(target)) * 512d,
            MidpointRounding.AwayFromZero);
        return PhysicalNoise.HashUnit(seed ^ 0x5b91, x, y);
    }

    private static bool CanBeOutlet(
        PhysicalGeographyField map,
        int[] componentMarks,
        int componentId,
        long surface,
        int neighbor)
    {
        if (neighbor < 0 || componentMarks[neighbor] == componentId)
        {
            return false;
        }

        var elevation = map.WaterKindCodes[neighbor] == PhysicalWaterKindCodes.Ocean
            ? long.MinValue
            : map.DrainageElevations[neighbor];
        return elevation <= surface;
    }

    private sealed record DepressionComponent(
        int ComponentId,
        List<int> Members,
        long SpillSurface);

    private sealed record SupportedLake(
        DepressionComponent Component,
        List<int> Members,
        long Surface,
        long MaximumDepth,
        long Overflow);

    private readonly record struct BasinCell(
        int TriangleIndex,
        long Floor,
        long WaterLoss,
        int DirectInputAdjustment);

    private readonly record struct StageBudget(
        int SupportedCount,
        long Loss,
        long DirectAdjustment);

    private readonly record struct OutletCandidate(
        int Member,
        int Target,
        int Rank,
        long Drainage,
        double Geometry)
    {
        public static OutletCandidate Invalid { get; } =
            new(-1, -1, int.MaxValue, long.MaxValue, double.MinValue);
    }
}
