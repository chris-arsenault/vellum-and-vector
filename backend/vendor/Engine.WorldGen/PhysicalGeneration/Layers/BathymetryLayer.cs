namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class BathymetryLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "bathymetry",
        0,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.OceanDistance,
        PhysicalGeographyFacts.Bathymetry,
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        MeasureSlopes(map);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean)
            {
                map.BathymetricZoneCodes[triangleIndex] = OceanZone(
                    map.WaterDepths[triangleIndex],
                    context.Profile);
            }
            else
            {
                map.BathymetricZoneCodes[triangleIndex] =
                    map.Elevation[triangleIndex] <= map.EffectiveSeaLevel +
                        PhysicalElevation.FromUnits(context.Profile.ShelfDepth / 2d) &&
                    map.OceanDistance[triangleIndex] is >= 0 and <= 18
                        ? PhysicalBathymetricZoneCodes.ExposedShelf
                        : PhysicalBathymetricZoneCodes.Land;
            }
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var zone = map.BathymetricZoneCodes[triangleIndex];
            if (zone is < PhysicalBathymetricZoneCodes.Min or > PhysicalBathymetricZoneCodes.Max ||
                (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean &&
                    zone == PhysicalBathymetricZoneCodes.Land))
            {
                throw new InvalidOperationException("Bathymetric classification is inconsistent.");
            }
        }
    }

    internal static void MeasureSlopes(PhysicalGeographyField map)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var slope = 0L;
            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
                if (neighbor >= 0)
                {
                    var drop = Math.Abs(
                        map.Elevation[triangleIndex] - map.Elevation[neighbor]);
                    slope = Math.Max(slope, drop);
                }
            }

            map.Slope[triangleIndex] = slope;
        }
    }

    private static int OceanZone(long depth, PhysicalGeographyGenerationProfile profile)
    {
        if (depth <= PhysicalElevation.FromUnits(profile.ShelfDepth))
        {
            return PhysicalBathymetricZoneCodes.Shelf;
        }

        return depth <= PhysicalElevation.FromUnits(profile.ShelfBreakDepth)
            ? PhysicalBathymetricZoneCodes.ShelfBreak
            : PhysicalBathymetricZoneCodes.DeepOcean;
    }
}
