namespace Engine.WorldGen;

internal static class FlowGraphAlgorithms
{
    public static int[] SourceToOutletOrder(PhysicalGeographyField map)
    {
        ArgumentNullException.ThrowIfNull(map);
        var indegree = new int[map.Grid.TriangleCount];
        for (var triangleIndex = 0; triangleIndex < indegree.Length; triangleIndex++)
        {
            var target = map.FlowTargets[triangleIndex];
            if (target >= 0)
            {
                indegree[target]++;
            }
        }

        var queue = new Queue<int>();
        for (var triangleIndex = 0; triangleIndex < indegree.Length; triangleIndex++)
        {
            if (indegree[triangleIndex] == 0)
            {
                queue.Enqueue(triangleIndex);
            }
        }

        var order = new int[indegree.Length];
        var count = 0;
        while (queue.TryDequeue(out var triangleIndex))
        {
            order[count++] = triangleIndex;
            var target = map.FlowTargets[triangleIndex];
            if (target >= 0 && --indegree[target] == 0)
            {
                queue.Enqueue(target);
            }
        }

        if (count != order.Length)
        {
            throw new InvalidOperationException(
                $"Physical flow graph contains a cycle: {DescribeCycle(map, indegree)}.");
        }

        return order;
    }

    public static int SaturatingAdd(int first, int second) =>
        first > int.MaxValue - second ? int.MaxValue : first + second;

    private static string DescribeCycle(PhysicalGeographyField map, int[] remainingIndegree)
    {
        var current = Array.FindIndex(remainingIndegree, value => value > 0);
        var positions = new Dictionary<int, int>();
        var path = new List<int>();
        while (current >= 0 && !positions.ContainsKey(current))
        {
            positions.Add(current, path.Count);
            path.Add(current);
            current = map.FlowTargets[current];
        }

        var cycleStart = current >= 0 ? positions.GetValueOrDefault(current) : 0;
        return string.Join(
            " -> ",
            path.Skip(cycleStart).Take(12).Select(index =>
                $"{index}[water={map.WaterKindCodes[index]},body={map.WaterBodyIds[index]}," +
                $"drain={map.DrainageElevations[index]},parent={map.DrainageParents[index]}]"));
    }
}
