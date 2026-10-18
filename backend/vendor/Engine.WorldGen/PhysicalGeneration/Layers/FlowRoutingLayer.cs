namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class FlowRoutingLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "flow-routing",
        0,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.DrainageConditioning |
        PhysicalGeographyFacts.DrainageGuidance |
        PhysicalGeographyFacts.Lakes,
        PhysicalGeographyFacts.FlowRouting,
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.FlowTargets.Fill(-1);
        map.FlowEdges.Fill(PhysicalGeographyCodes.NoFlowEdge);
        map.DrainageBasinIds.Clear();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.None)
            {
                map.FlowTargets[triangleIndex] = map.DrainageGuidanceTargets[triangleIndex];
            }
        }

        RouteLakeBodies(map, context.Seed);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var target = map.FlowTargets[triangleIndex];
            if (target >= 0)
            {
                map.FlowEdges[triangleIndex] = map.Grid.EdgeLeadingTo(triangleIndex, target);
            }
        }

        AssignBasins(map);
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        _ = FlowGraphAlgorithms.SourceToOutletOrder(map);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            ValidateTriangle(map, triangleIndex);
        }
    }

    private static void ValidateTriangle(PhysicalGeographyField map, int triangleIndex)
    {
        var target = map.FlowTargets[triangleIndex];
        if (target < 0)
        {
            if (map.WaterKindCodes[triangleIndex] is not
                (PhysicalWaterKindCodes.Ocean or PhysicalWaterKindCodes.Lake))
            {
                throw new InvalidOperationException("Dry triangle has no drainage outlet.");
            }

            return;
        }

        var edge = map.FlowEdges[triangleIndex];
        if (edge is < 0 or > 2 || map.Grid.NeighborTriangleIndex(triangleIndex, edge) != target)
        {
            throw new InvalidOperationException("Flow target is not an adjacent triangle.");
        }

        if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.None &&
            map.WaterKindCodes[target] != PhysicalWaterKindCodes.Ocean &&
            map.DrainageElevations[target] > map.DrainageElevations[triangleIndex])
        {
            throw new InvalidOperationException("Conditioned drainage flows uphill.");
        }
    }

    private static void RouteLakeBodies(PhysicalGeographyField map, int seed)
    {
        var bodies = new Dictionary<int, List<int>>();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Lake)
            {
                var bodyId = map.WaterBodyIds[triangleIndex];
                if (!bodies.TryGetValue(bodyId, out var members))
                {
                    members = [];
                    bodies.Add(bodyId, members);
                }

                members.Add(triangleIndex);
            }
        }

        foreach (var members in bodies.Values)
        {
            RouteLakeBody(map, members, seed);
        }
    }

    private static void RouteLakeBody(PhysicalGeographyField map, List<int> members, int seed)
    {
        var root = members.FirstOrDefault(member => map.LakeOutletTargets[member] >= 0, -1);
        var outletTarget = root >= 0 ? map.LakeOutletTargets[root] : -1;
        root = root >= 0 ? root : SelectStableLakeRoot(map, members, seed);
        var ranks = BuildLakeRanks(map, members.Count, root);
        map.FlowTargets[root] = outletTarget;
        RouteOutletEscape(map, outletTarget);
        foreach (var member in members)
        {
            if (member != root)
            {
                map.FlowTargets[member] = SelectLowerRankedNeighbor(map, ranks, member, root);
            }
        }
    }

    private static int SelectStableLakeRoot(
        PhysicalGeographyField map,
        IReadOnlyList<int> members,
        int seed)
    {
        var selected = -1;
        var best = double.MinValue;
        foreach (var member in members)
        {
            var x = (int)Math.Round(map.Grid.TriangleX(member) * 1024d, MidpointRounding.AwayFromZero);
            var y = (int)Math.Round(map.Grid.TriangleY(member) * 1024d, MidpointRounding.AwayFromZero);
            var score = PhysicalNoise.HashUnit(seed ^ 0x6c53, x, y);
            if (score > best)
            {
                selected = member;
                best = score;
            }
        }

        return selected >= 0
            ? selected
            : throw new InvalidOperationException("Lake body has no members.");
    }

    private static void RouteOutletEscape(PhysicalGeographyField map, int outletTarget)
    {
        var current = outletTarget;
        while (current >= 0 && map.WaterKindCodes[current] == PhysicalWaterKindCodes.None)
        {
            var parent = map.DrainageParents[current];
            if (parent < 0)
            {
                throw new InvalidOperationException("Lake spill route does not reach water.");
            }

            map.FlowTargets[current] = parent;
            current = parent;
        }
    }

    private static Dictionary<int, int> BuildLakeRanks(
        PhysicalGeographyField map,
        int bodySize,
        int root)
    {
        var ranks = new Dictionary<int, int>(bodySize) { [root] = 0 };
        var queue = new Queue<int>();
        queue.Enqueue(root);
        while (queue.TryDequeue(out var member))
        {
            AddUnrankedLakeNeighbors(map, ranks, queue, root, member);
        }

        return ranks;
    }

    private static void AddUnrankedLakeNeighbors(
        PhysicalGeographyField map,
        Dictionary<int, int> ranks,
        Queue<int> queue,
        int root,
        int member)
    {
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(member, edge);
            if (neighbor >= 0 && map.WaterKindCodes[neighbor] == PhysicalWaterKindCodes.Lake &&
                map.WaterBodyIds[neighbor] == map.WaterBodyIds[root] &&
                ranks.TryAdd(neighbor, ranks[member] + 1))
            {
                queue.Enqueue(neighbor);
            }
        }
    }

    private static int SelectLowerRankedNeighbor(
        PhysicalGeographyField map,
        Dictionary<int, int> ranks,
        int member,
        int root)
    {
        var targetRank = ranks[member];
        Span<int> candidates = stackalloc int[3];
        var candidateCount = 0;
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(member, edge);
            if (neighbor >= 0 && ranks.TryGetValue(neighbor, out var rank) && rank < targetRank)
            {
                candidates[candidateCount++] = neighbor;
            }
        }

        if (candidateCount == 0)
        {
            throw new InvalidOperationException("Lake member cannot reach its outlet.");
        }

        return ConditionedFlowResolver.SelectByOutletAlignment(
            map,
            candidates[..candidateCount],
            member,
            root,
            seed: root);
    }

    private static void AssignBasins(PhysicalGeographyField map)
    {
        var order = FlowGraphAlgorithms.SourceToOutletOrder(map);
        var nextBasin = 0;
        for (var orderIndex = order.Length - 1; orderIndex >= 0; orderIndex--)
        {
            var triangleIndex = order[orderIndex];
            if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean)
            {
                continue;
            }

            var target = map.FlowTargets[triangleIndex];
            map.DrainageBasinIds[triangleIndex] = target < 0 ||
                map.WaterKindCodes[target] == PhysicalWaterKindCodes.Ocean
                    ? ++nextBasin
                    : map.DrainageBasinIds[target];
        }
    }
}
