namespace Engine.WorldGen;

internal sealed class PhysicalEpochHistoryLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "physical-epoch-history",
        0,
        PhysicalGeographyFacts.TectonicProvinces |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Geothermal |
        PhysicalGeographyFacts.VolcanicConstruction |
        PhysicalGeographyFacts.LandscapeHistory |
        PhysicalGeographyFacts.SedimentTransport |
        PhysicalGeographyFacts.GlacialEvolution |
        PhysicalGeographyFacts.CoastalEvolution,
        PhysicalGeographyFacts.EpochHistory,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
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
        PhysicalGeographyFacts.RiverGeometry |
        PhysicalGeographyFacts.Floodplains |
        PhysicalGeographyFacts.Deltas |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        if (!context.IsEvolutionEpoch || context.EpochIndex != map.CompletedEpochCount)
        {
            throw new InvalidOperationException("Physical epoch history was applied out of order.");
        }

        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            map.GeothermalHistory[triangleIndex] = Math.Max(
                map.GeothermalHistory[triangleIndex],
                map.Geothermal[triangleIndex]);
        }

        map.CompletedEpochCount++;
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        if (map.CompletedEpochCount != context.EpochIndex + 1 ||
            map.CompletedEpochCount > context.EpochCount)
        {
            throw new InvalidOperationException("Physical epoch history is invalid.");
        }

        foreach (var value in map.GeothermalHistory)
        {
            if (value is < 0 or > 1000)
            {
                throw new InvalidOperationException("Physical epoch history is invalid.");
            }
        }
    }
}
