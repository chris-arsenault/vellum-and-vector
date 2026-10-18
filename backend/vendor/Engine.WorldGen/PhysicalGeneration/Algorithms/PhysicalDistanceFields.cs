namespace Engine.WorldGen;

using System.Buffers;

using Engine.Constants;

internal static class PhysicalDistanceFields
{
    public static void FillFromOcean(PhysicalGeographyField map, Span<int> distance)
    {
        ArgumentNullException.ThrowIfNull(map);
        if (distance.Length != map.Grid.TriangleCount)
        {
            throw new ArgumentException("Ocean-distance field length does not match the physical grid.", nameof(distance));
        }

        distance.Fill(-1);
        var queue = ArrayPool<int>.Shared.Rent(map.Grid.TriangleCount);
        try
        {
            var head = 0;
            var tail = 0;
            for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
            {
                if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean)
                {
                    distance[triangleIndex] = 0;
                    queue[tail++] = triangleIndex;
                }
            }

            while (head < tail)
            {
                var triangleIndex = queue[head++];
                var nextDistance = distance[triangleIndex] + 1;
                for (var edge = 0; edge < 3; edge++)
                {
                    var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
                    if (neighbor >= 0 && distance[neighbor] < 0)
                    {
                        distance[neighbor] = nextDistance;
                        queue[tail++] = neighbor;
                    }
                }
            }
        }
        finally
        {
            ArrayPool<int>.Shared.Return(queue);
        }
    }
}
