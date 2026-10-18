namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class OceanConnectivityLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "ocean-connectivity",
        0,
        PhysicalGeographyFacts.Elevation,
        PhysicalGeographyFacts.Ocean,
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.OceanDistance |
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
        PhysicalGeographyFacts.SeaIce |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.WaterKindCodes.Clear();
        map.ClearWaterSurfaces();
        map.WaterBodyIds.Clear();
        map.EffectiveSeaLevel = ResolveEffectiveSeaLevel(map, context);
        FloodConnectedOcean(map);
    }

    private static long ResolveEffectiveSeaLevel(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context)
    {
        if (!map.SeaLevelInitialized)
        {
            map.BaseSeaLevel = FindInitialBaseSeaLevel(map, context.Profile);
            map.SeaLevelInitialized = true;
        }

        return checked(
            map.BaseSeaLevel + PhysicalElevation.FromUnits(context.SeaLevelOffset));
    }

    private static long FindInitialBaseSeaLevel(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile)
    {
        var targetCount = Math.Clamp(
            (int)Math.Round(
                map.Grid.ContentTriangleCount * profile.QualityTargets.OceanCoverage.Target,
                MidpointRounding.AwayFromZero),
            1,
            map.Grid.ContentTriangleCount);
        var seaLevel = ConnectedOceanLevel(map, targetCount) +
            PhysicalElevation.FromUnits(profile.SeaLevel * profile.ElevationScale);
        var minimumBoundary = long.MaxValue;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (!map.Grid.TriangleIsOnWorkBoundary(triangleIndex))
            {
                continue;
            }

            minimumBoundary = Math.Min(minimumBoundary, map.Elevation[triangleIndex]);
        }

        return Math.Max(seaLevel, minimumBoundary + PhysicalElevation.FromUnits(1));
    }

    private static long ConnectedOceanLevel(PhysicalGeographyField map, int targetCount)
    {
        var order = IntegerKeyOrdering.DescendingThenIndex(map.Elevation);
        var parent = new int[map.Grid.TriangleCount];
        var componentSizes = new int[parent.Length];
        var configuredCounts = new int[parent.Length];
        var active = new bool[parent.Length];
        var boundaryConnected = new bool[parent.Length];
        Array.Fill(parent, -1);
        var connectedConfigured = 0;
        var cursor = order.Length - 1;
        var selectedElevation = map.Elevation[order[0]];
        while (cursor >= 0)
        {
            selectedElevation = map.Elevation[order[cursor]];
            var groupEnd = cursor;
            cursor = ActivateElevationGroup(
                map,
                order,
                cursor,
                selectedElevation,
                parent,
                componentSizes,
                configuredCounts,
                active,
                boundaryConnected,
                ref connectedConfigured);
            ConnectElevationGroup(
                map,
                order,
                cursor,
                groupEnd,
                parent,
                componentSizes,
                configuredCounts,
                active,
                boundaryConnected,
                ref connectedConfigured);

            if (connectedConfigured >= targetCount)
            {
                break;
            }
        }

        return selectedElevation == long.MaxValue
            ? long.MaxValue
            : selectedElevation + PhysicalElevation.FromUnits(1);
    }

    private static int ActivateElevationGroup(
        PhysicalGeographyField map,
        int[] order,
        int cursor,
        long elevation,
        int[] parent,
        int[] componentSizes,
        int[] configuredCounts,
        bool[] active,
        bool[] boundaryConnected,
        ref int connectedConfigured)
    {
        while (cursor >= 0 && map.Elevation[order[cursor]] == elevation)
        {
            var triangleIndex = order[cursor--];
            active[triangleIndex] = true;
            parent[triangleIndex] = triangleIndex;
            componentSizes[triangleIndex] = 1;
            configuredCounts[triangleIndex] =
                map.Grid.TriangleIsInsideContentDomain(triangleIndex) ? 1 : 0;
            boundaryConnected[triangleIndex] = map.Grid.TriangleIsOnWorkBoundary(triangleIndex);
            if (boundaryConnected[triangleIndex])
            {
                connectedConfigured += configuredCounts[triangleIndex];
            }
        }

        return cursor;
    }

    private static void ConnectElevationGroup(
        PhysicalGeographyField map,
        int[] order,
        int cursor,
        int groupEnd,
        int[] parent,
        int[] componentSizes,
        int[] configuredCounts,
        bool[] active,
        bool[] boundaryConnected,
        ref int connectedConfigured)
    {
        for (var index = groupEnd; index > cursor; index--)
        {
            var triangleIndex = order[index];
            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
                if (neighbor >= 0 && active[neighbor])
                {
                    UnionOceanComponents(
                        parent,
                        componentSizes,
                        configuredCounts,
                        boundaryConnected,
                        triangleIndex,
                        neighbor,
                        ref connectedConfigured);
                }
            }
        }
    }

    private static void UnionOceanComponents(
        int[] parent,
        int[] componentSizes,
        int[] configuredCounts,
        bool[] boundaryConnected,
        int first,
        int second,
        ref int connectedConfigured)
    {
        var firstRoot = FindOceanComponent(parent, first);
        var secondRoot = FindOceanComponent(parent, second);
        if (firstRoot == secondRoot)
        {
            return;
        }

        if (componentSizes[firstRoot] < componentSizes[secondRoot])
        {
            (firstRoot, secondRoot) = (secondRoot, firstRoot);
        }

        if (boundaryConnected[firstRoot])
        {
            connectedConfigured -= configuredCounts[firstRoot];
        }

        if (boundaryConnected[secondRoot])
        {
            connectedConfigured -= configuredCounts[secondRoot];
        }

        parent[secondRoot] = firstRoot;
        componentSizes[firstRoot] += componentSizes[secondRoot];
        configuredCounts[firstRoot] += configuredCounts[secondRoot];
        boundaryConnected[firstRoot] |= boundaryConnected[secondRoot];
        if (boundaryConnected[firstRoot])
        {
            connectedConfigured += configuredCounts[firstRoot];
        }
    }

    private static int FindOceanComponent(int[] parent, int triangleIndex)
    {
        var root = triangleIndex;
        while (parent[root] != root)
        {
            root = parent[root];
        }

        while (parent[triangleIndex] != triangleIndex)
        {
            var next = parent[triangleIndex];
            parent[triangleIndex] = root;
            triangleIndex = next;
        }

        return root;
    }

    private static void FloodConnectedOcean(PhysicalGeographyField map)
    {
        var queue = new Queue<int>();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (!map.Grid.TriangleIsOnWorkBoundary(triangleIndex))
            {
                continue;
            }

            MarkIfOcean(map, triangleIndex, queue);
        }

        while (queue.TryDequeue(out var triangleIndex))
        {
            for (var edge = 0; edge < 3; edge++)
            {
                MarkIfOcean(map, map.Grid.NeighborTriangleIndex(triangleIndex, edge), queue);
            }
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        var count = 0;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.Ocean)
            {
                continue;
            }

            count++;
            if (map.Elevation[triangleIndex] >= map.EffectiveSeaLevel ||
                map.WaterDepths[triangleIndex] <= 0 || map.WaterBodyIds[triangleIndex] != 1 ||
                map.WaterSurfaceElevations[triangleIndex] != map.EffectiveSeaLevel)
            {
                throw new InvalidOperationException("Ocean classification contradicts sea level.");
            }
        }

        if (count == 0)
        {
            throw new InvalidOperationException("Physical geography contains no connected ocean.");
        }
    }

    private static void MarkIfOcean(PhysicalGeographyField map, int triangleIndex, Queue<int> queue)
    {
        if (triangleIndex < 0 || map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.None ||
            map.Elevation[triangleIndex] >= map.EffectiveSeaLevel)
        {
            return;
        }

        map.WaterKindCodes[triangleIndex] = PhysicalWaterKindCodes.Ocean;
        map.WaterBodyIds[triangleIndex] = 1;
        map.SetWaterSurface(triangleIndex, map.EffectiveSeaLevel);
        queue.Enqueue(triangleIndex);
    }
}
