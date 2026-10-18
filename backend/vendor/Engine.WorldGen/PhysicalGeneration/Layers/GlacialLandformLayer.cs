namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class GlacialLandformLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "glacial-landforms",
        0,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.IceFlow |
        PhysicalGeographyFacts.GlacialEvolution,
        PhysicalGeographyFacts.GlacialRelief,
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.LandformCodes.Clear();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.None ||
                map.MaximumGroundedIceFlux[triangleIndex] < context.Profile.GlacierFluxThreshold)
            {
                continue;
            }

            if (IsGlacialValley(map, triangleIndex, context.Profile))
            {
                map.LandformCodes[triangleIndex] = PhysicalLandformCodes.UValley;
            }

            if (IsCirqueHead(map, triangleIndex, context.Profile))
            {
                map.LandformCodes[triangleIndex] = PhysicalLandformCodes.Cirque;
            }

            if (IsTerminus(map, triangleIndex, context.Profile))
            {
                map.LandformCodes[triangleIndex] = PhysicalLandformCodes.Moraine;
            }
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.LandformCodes[triangleIndex] is
                    PhysicalLandformCodes.UValley or
                    PhysicalLandformCodes.Cirque or
                    PhysicalLandformCodes.Moraine &&
                map.MaximumGroundedIceFlux[triangleIndex] < context.Profile.GlacierFluxThreshold)
            {
                throw new InvalidOperationException("Glacial landform lacks qualifying grounded-ice flux.");
            }
        }
    }

    private static bool IsGlacialValley(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile) =>
        map.CumulativeGlacialErosion[triangleIndex] > 0 &&
        (map.RiverOrders[triangleIndex] > 0 ||
            map.FlowAccumulation[triangleIndex] >= profile.RiverAccumulationThreshold / 2);

    private static bool IsCirqueHead(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile)
    {
        if (map.MaximumIceThickness[triangleIndex] < profile.GlacierThicknessThreshold)
        {
            return false;
        }

        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
            if (neighbor >= 0 &&
                map.MaximumIceThickness[neighbor] > map.MaximumIceThickness[triangleIndex])
            {
                return false;
            }
        }

        return true;
    }

    private static bool IsTerminus(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile) =>
        map.CumulativeDeposition[triangleIndex] > 0 &&
        map.MaximumGroundedIceFlux[triangleIndex] >= profile.GlacierFluxThreshold;
}
