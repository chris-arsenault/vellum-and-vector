namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Identifies discrete features entirely on the generated microtriangle
/// lattice. Runtime-map coverage is assigned only after generation.
/// </summary>
public static class PhysicalGeologicalFeatureIdentification
{
    private const int RiverSystemMinimumDischarge = 60000;
    private const int LakeMinimumTriangles = 96;
    private const int CraterMinimumTriangles = 48;

    public static PhysicalGeologicalFeatureMap Identify(PhysicalGeographyField field)
    {
        ArgumentNullException.ThrowIfNull(field);
        var map = new PhysicalGeologicalFeatureMap();
        IdentifyRiverSystems(field, map);
        IdentifyLakes(field, map);
        IdentifyPeaks(field, map);
        IdentifyCraters(field, map);
        return map;
    }

    // The landform classifier already found the summits (strict local
    // maxima with prominence); a peak feature is a connected cluster of
    // them, anchored at its highest triangle, magnitude in elevation units.
    private static void IdentifyPeaks(
        PhysicalGeographyField field,
        PhysicalGeologicalFeatureMap map)
    {
        IdentifyLandformClusters(
            field,
            map,
            PhysicalGeologicalFeatureKind.Peak,
            static code => code == PhysicalLandformCodes.Peak,
            minimumTriangles: 1,
            anchor: static (f, members) => HighestOf(f, members),
            magnitude: static (f, anchor, _) => PhysicalElevation.ToUnits(f.Elevation[anchor]));
    }

    // A crater is remembered by its excavation: basin floor plus rim ring
    // as one feature, anchored where the digging went deepest.
    private static void IdentifyCraters(
        PhysicalGeographyField field,
        PhysicalGeologicalFeatureMap map)
    {
        IdentifyLandformClusters(
            field,
            map,
            PhysicalGeologicalFeatureKind.Crater,
            static code => code is PhysicalLandformCodes.ImpactBasin or PhysicalLandformCodes.ImpactRim,
            minimumTriangles: CraterMinimumTriangles,
            anchor: static (f, members) => DeepestExcavationOf(f, members),
            magnitude: static (_, _, members) => members.Count);
    }

    private static void IdentifyLandformClusters(
        PhysicalGeographyField field,
        PhysicalGeologicalFeatureMap map,
        PhysicalGeologicalFeatureKind kind,
        Func<int, bool> matches,
        int minimumTriangles,
        Func<PhysicalGeographyField, HashSet<int>, int> anchor,
        Func<PhysicalGeographyField, int, HashSet<int>, int> magnitude)
    {
        var visited = new bool[field.Grid.TriangleCount];
        for (var triangleIndex = 0;
            triangleIndex < field.Grid.TriangleCount;
            triangleIndex++)
        {
            if (visited[triangleIndex] || !matches(field.LandformCodes[triangleIndex]))
            {
                continue;
            }

            var members = GatherLandformCluster(field, matches, visited, triangleIndex);
            if (members.Count < minimumTriangles)
            {
                continue;
            }

            var anchorTriangle = anchor(field, members);
            map.Add(
                new PhysicalGeologicalFeature(
                    FeatureId(kind, field.Grid.TriangleCoordAt(anchorTriangle)),
                    kind,
                    anchorTriangle,
                    magnitude(field, anchorTriangle, members),
                    members.Count),
                members);
        }
    }

    private static HashSet<int> GatherLandformCluster(
        PhysicalGeographyField field,
        Func<int, bool> matches,
        bool[] visited,
        int start)
    {
        var members = new HashSet<int>();
        var stack = new Stack<int>();
        stack.Push(start);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            if (visited[current] || !matches(field.LandformCodes[current]))
            {
                continue;
            }

            visited[current] = true;
            members.Add(current);
            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = field.Grid.NeighborTriangleIndex(current, edge);
                if (neighbor >= 0 && !visited[neighbor])
                {
                    stack.Push(neighbor);
                }
            }
        }

        return members;
    }

    private static int HighestOf(PhysicalGeographyField field, HashSet<int> members)
    {
        var best = -1;
        foreach (var member in members)
        {
            if (best < 0 || field.Elevation[member] > field.Elevation[best])
            {
                best = member;
            }
        }

        return best;
    }

    private static int DeepestExcavationOf(PhysicalGeographyField field, HashSet<int> members)
    {
        var best = -1;
        foreach (var member in members)
        {
            if (best < 0 || field.ImpactExcavation[member] > field.ImpactExcavation[best])
            {
                best = member;
            }
        }

        return best;
    }

    private static void IdentifyRiverSystems(
        PhysicalGeographyField field,
        PhysicalGeologicalFeatureMap map)
    {
        var targets = FlowTargets(field);
        var upstream = BuildUpstream(field, targets);
        var claimed = new bool[field.Grid.TriangleCount];
        for (var triangleIndex = 0;
            triangleIndex < field.Grid.TriangleCount;
            triangleIndex++)
        {
            if (!IsRiverMouth(field, targets, triangleIndex) ||
                field.FlowAccumulation[triangleIndex] < RiverSystemMinimumDischarge)
            {
                continue;
            }

            var members = new HashSet<int>();
            GatherUpstream(field, upstream, claimed, triangleIndex, members);
            if (members.Count == 0)
            {
                continue;
            }

            map.Add(
                new PhysicalGeologicalFeature(
                    FeatureId(
                        PhysicalGeologicalFeatureKind.RiverSystem,
                        field.Grid.TriangleCoordAt(triangleIndex)),
                    PhysicalGeologicalFeatureKind.RiverSystem,
                    triangleIndex,
                    field.FlowAccumulation[triangleIndex],
                    members.Count),
                members);
        }
    }

    private static void IdentifyLakes(
        PhysicalGeographyField field,
        PhysicalGeologicalFeatureMap map)
    {
        var membersByBody = new Dictionary<int, HashSet<int>>();
        var lowestByBody = new Dictionary<int, int>();
        for (var triangleIndex = 0;
            triangleIndex < field.Grid.TriangleCount;
            triangleIndex++)
        {
            if (field.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.Lake ||
                field.WaterBodyIds[triangleIndex] <= 0)
            {
                continue;
            }

            var body = field.WaterBodyIds[triangleIndex];
            if (!membersByBody.TryGetValue(body, out var members))
            {
                members = [];
                membersByBody[body] = members;
            }

            members.Add(triangleIndex);
            if (!lowestByBody.TryGetValue(body, out var best) ||
                field.Elevation[triangleIndex] < field.Elevation[best])
            {
                lowestByBody[body] = triangleIndex;
            }
        }

        foreach (var (body, members) in membersByBody)
        {
            if (members.Count < LakeMinimumTriangles)
            {
                continue;
            }

            var anchor = lowestByBody[body];
            map.Add(
                new PhysicalGeologicalFeature(
                    FeatureId(
                        PhysicalGeologicalFeatureKind.Lake,
                        field.Grid.TriangleCoordAt(anchor)),
                    PhysicalGeologicalFeatureKind.Lake,
                    anchor,
                    members.Count,
                    members.Count),
                members);
        }
    }

    private static bool IsRiverMouth(
        PhysicalGeographyField field,
        int[] targets,
        int triangleIndex)
    {
        if (field.RiverOrders[triangleIndex] <= 0)
        {
            return false;
        }

        var target = targets[triangleIndex];
        return target < 0 || field.WaterKindCodes[target] == PhysicalWaterKindCodes.Ocean;
    }

    private static void GatherUpstream(
        PhysicalGeographyField field,
        List<int>[] upstream,
        bool[] claimed,
        int mouth,
        HashSet<int> members)
    {
        var stack = new Stack<int>();
        stack.Push(mouth);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            if (claimed[current] || field.RiverOrders[current] <= 0)
            {
                continue;
            }

            claimed[current] = true;
            members.Add(current);
            foreach (var source in upstream[current] ?? [])
            {
                stack.Push(source);
            }
        }
    }

    private static List<int>[] BuildUpstream(PhysicalGeographyField field, int[] targets)
    {
        var upstream = new List<int>[field.Grid.TriangleCount];
        for (var triangleIndex = 0; triangleIndex < targets.Length; triangleIndex++)
        {
            var target = targets[triangleIndex];
            if (target < 0 || field.RiverOrders[triangleIndex] <= 0)
            {
                continue;
            }

            (upstream[target] ??= []).Add(triangleIndex);
        }

        return upstream;
    }

    private static int[] FlowTargets(PhysicalGeographyField field)
    {
        var targets = new int[field.Grid.TriangleCount];
        for (var triangleIndex = 0; triangleIndex < targets.Length; triangleIndex++)
        {
            var edge = field.FlowEdges[triangleIndex];
            targets[triangleIndex] = edge is >= 0 and <= 2
                ? field.Grid.NeighborTriangleIndex(triangleIndex, edge)
                : -1;
        }

        return targets;
    }

    private static int FeatureId(
        PhysicalGeologicalFeatureKind kind,
        MicrotriangleCoord anchor)
    {
        unchecked
        {
            var hash = 17;
            hash = (hash * 486187739) + (int)kind;
            hash = (hash * 486187739) + anchor.U;
            hash = (hash * 486187739) + anchor.V;
            hash = (hash * 486187739) + (anchor.Inverted ? 1 : 0);
            return hash & 0x7fffffff;
        }
    }
}
