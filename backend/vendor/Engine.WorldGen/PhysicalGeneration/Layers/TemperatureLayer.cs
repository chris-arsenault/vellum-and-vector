namespace Engine.WorldGen;

internal sealed class TemperatureLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "temperature",
        0,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.OceanDistance |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.Geothermal |
        PhysicalGeographyFacts.Warmth,
        PhysicalGeographyFacts.Temperature,
        PhysicalGeographyFacts.Moisture |
        PhysicalGeographyFacts.Precipitation |
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.GlacialMeltwater |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.SeaIce |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var lapse = PhysicalElevation.ToUnits(
                Math.Max(0L, map.Elevation[triangleIndex] - map.EffectiveSeaLevel)) *
                context.Profile.ElevationTemperatureLapse /
                context.Profile.ElevationScale;
            var moderation = map.OceanDistance[triangleIndex] < 0
                ? 0
                : Math.Max(
                    0,
                    context.Profile.OceanModerationStrength -
                        (map.OceanDistance[triangleIndex] * context.Profile.OceanModerationStrength /
                            context.Profile.OceanModerationDistance));
            var geothermal = map.Geothermal[triangleIndex] *
                context.Profile.GeothermalTemperatureStrength / 1000;
            var currentHeat = map.OceanCurrentHeat[triangleIndex] *
                map.OceanCurrentStrength[triangleIndex] / 1000 *
                context.Profile.OceanCurrentTemperatureStrength / 1000;
            map.Temperature[triangleIndex] = Math.Clamp(
                context.Profile.TemperatureBaseline + context.TemperatureOffset - lapse + moderation +
                geothermal + currentHeat + map.Warmth[triangleIndex] +
                map.ExternalHeatForcing[triangleIndex],
                0,
                1000);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        foreach (var value in map.Temperature)
        {
            if (value is < 0 or > 1000)
            {
                throw new InvalidOperationException("Temperature is out of range.");
            }
        }
    }
}
