namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Establishes one coherent generation-only wind and upwind graph for the
/// current epoch. Moisture and precipitation consume the same field instead
/// of inventing independent prevailing winds.
/// </summary>
internal sealed class AtmosphericFlowLayer : IPhysicalGeographyLayer
{
    private const int MoisturePathSteps = 14;
    private const int PrecipitationPathSteps = 18;

    public PhysicalGeographyLayerContract Contract { get; } = new(
        "atmospheric-flow",
        0x4e28b3,
        PhysicalGeographyFacts.Elevation | PhysicalGeographyFacts.Ocean,
        PhysicalGeographyFacts.AtmosphericFlow,
        PhysicalGeographyFacts.Moisture |
        PhysicalGeographyFacts.Precipitation |
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            AtmosphericFlow.WindDirection(
                map,
                context,
                triangleIndex,
                out var windX,
                out var windY);
            map.WindX[triangleIndex] = (int)Math.Round(
                windX * 1000d,
                MidpointRounding.AwayFromZero);
            map.WindY[triangleIndex] = (int)Math.Round(
                windY * 1000d,
                MidpointRounding.AwayFromZero);
            map.UpwindTargets[triangleIndex] = AtmosphericFlow.MostAlignedNeighbor(
                map,
                triangleIndex,
                -windX,
                -windY);
        }

        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            TraceAirMass(map, context.Profile.ElevationScale, triangleIndex);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (!TriangleIsValid(map, triangleIndex))
            {
                throw new InvalidOperationException("Atmospheric flow contains an invalid wind path.");
            }
        }
    }

    private static bool TriangleIsValid(PhysicalGeographyField map, int triangleIndex) =>
        IsSignedScalar(map.WindX[triangleIndex]) &&
        IsSignedScalar(map.WindY[triangleIndex]) &&
        IsUnitScalar(map.MoistureBarriers[triangleIndex]) &&
        IsUnitScalar(map.PrecipitationBarriers[triangleIndex]) &&
        OceanSourceIsValid(map, map.UpwindOceanSources[triangleIndex]) &&
        TargetIsAdjacent(map.Grid, triangleIndex, map.UpwindTargets[triangleIndex]);

    private static bool IsSignedScalar(int value) => value is >= -1000 and <= 1000;

    private static bool IsUnitScalar(int value) => value is >= 0 and <= 1000;

    private static void TraceAirMass(
        PhysicalGeographyField map,
        int elevationScale,
        int start)
    {
        var current = start;
        var maximumBarrier = 0L;
        var moistureBarrier = -1L;
        var oceanSource = -1;
        for (var step = 1; step <= PrecipitationPathSteps; step++)
        {
            var next = map.UpwindTargets[current];
            if (next < 0 || next == current)
            {
                break;
            }

            current = next;
            maximumBarrier = Math.Max(maximumBarrier, map.Elevation[current] - map.Elevation[start]);
            if (step == MoisturePathSteps)
            {
                moistureBarrier = maximumBarrier;
            }

            if (map.WaterKindCodes[current] == PhysicalWaterKindCodes.Ocean)
            {
                oceanSource = current;
                break;
            }
        }

        moistureBarrier = moistureBarrier < 0 ? maximumBarrier : moistureBarrier;
        map.MoistureBarriers[start] = NormalizeBarrier(moistureBarrier, elevationScale);
        map.PrecipitationBarriers[start] = NormalizeBarrier(maximumBarrier, elevationScale);
        map.UpwindOceanSources[start] = oceanSource;
    }

    private static int NormalizeBarrier(long barrier, int elevationScale) =>
        Math.Clamp(
            PhysicalElevation.ToUnits(barrier) * 1000 / Math.Max(1, elevationScale / 2),
            0,
            1000);

    private static bool OceanSourceIsValid(PhysicalGeographyField map, int oceanSource) =>
        oceanSource < 0 ||
        (oceanSource < map.Grid.TriangleCount &&
            map.WaterKindCodes[oceanSource] == PhysicalWaterKindCodes.Ocean);

    private static bool TargetIsAdjacent(PhysicalGeographyGrid grid, int triangleIndex, int target)
    {
        if (target < 0)
        {
            return true;
        }

        for (var edge = 0; edge < 3; edge++)
        {
            if (grid.NeighborTriangleIndex(triangleIndex, edge) == target)
            {
                return true;
            }
        }

        return false;
    }
}
