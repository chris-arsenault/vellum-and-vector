namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class LandmassLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "landmasses-and-shelf-groups",
        0,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry,
        PhysicalGeographyFacts.Landmasses,
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.LandmassIds.Clear();
        map.LandmassClassCodes.Clear();
        map.ContinentalGroupIds.Clear();
        LabelLandmasses(map, context.Profile);
        LabelShelfGroups(map, context.Profile);
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (!TriangleIsClassified(map, triangleIndex))
            {
                throw new InvalidOperationException("Dry geography is missing landmass classification.");
            }
        }
    }

    private static bool TriangleIsClassified(PhysicalGeographyField map, int triangleIndex)
    {
        if (!IsDryLand(map, triangleIndex))
        {
            return true;
        }

        var classCode = map.LandmassClassCodes[triangleIndex];
        return map.LandmassIds[triangleIndex] > 0 &&
            classCode >= PhysicalLandmassClassCodes.Island &&
            classCode <= PhysicalLandmassClassCodes.Continent &&
            map.ContinentalGroupIds[triangleIndex] > 0;
    }

    private static void LabelLandmasses(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile)
    {
        var nextId = 0;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (!IsDryLand(map, triangleIndex) ||
                map.LandmassIds[triangleIndex] != 0)
            {
                continue;
            }

            nextId++;
            var members = CollectLandmass(map, triangleIndex, nextId);
            var classCode = members.Count >= profile.IslandTriangleThreshold
                ? PhysicalLandmassClassCodes.Continent
                : PhysicalLandmassClassCodes.Island;
            foreach (var member in members)
            {
                map.LandmassClassCodes[member] = classCode;
            }
        }
    }

    private static List<int> CollectLandmass(PhysicalGeographyField map, int start, int landmassId)
    {
        var members = new List<int>();
        var queue = new Queue<int>();
        map.LandmassIds[start] = landmassId;
        queue.Enqueue(start);
        while (queue.TryDequeue(out var member))
        {
            members.Add(member);
            EnqueueDryNeighbors(map, queue, member, landmassId);
        }

        return members;
    }

    private static void EnqueueDryNeighbors(
        PhysicalGeographyField map,
        Queue<int> queue,
        int member,
        int landmassId)
    {
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(member, edge);
            if (neighbor >= 0 && IsDryLand(map, neighbor) &&
                map.LandmassIds[neighbor] == 0)
            {
                map.LandmassIds[neighbor] = landmassId;
                queue.Enqueue(neighbor);
            }
        }
    }

    private static void LabelShelfGroups(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile)
    {
        var shelfFloor = map.EffectiveSeaLevel - PhysicalElevation.FromUnits(profile.ShelfBreakDepth);
        var queue = new Queue<int>();
        var nextId = 0;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.Elevation[triangleIndex] < shelfFloor || map.ContinentalGroupIds[triangleIndex] != 0)
            {
                continue;
            }

            nextId++;
            map.ContinentalGroupIds[triangleIndex] = nextId;
            queue.Enqueue(triangleIndex);
            while (queue.TryDequeue(out var member))
            {
                for (var edge = 0; edge < 3; edge++)
                {
                    var neighbor = map.Grid.NeighborTriangleIndex(member, edge);
                    if (neighbor >= 0 && map.Elevation[neighbor] >= shelfFloor &&
                        map.ContinentalGroupIds[neighbor] == 0)
                    {
                        map.ContinentalGroupIds[neighbor] = nextId;
                        queue.Enqueue(neighbor);
                    }
                }
            }
        }

    }

    private static bool IsDryLand(PhysicalGeographyField map, int triangleIndex) =>
        map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.None &&
        map.Elevation[triangleIndex] >= map.EffectiveSeaLevel;
}
