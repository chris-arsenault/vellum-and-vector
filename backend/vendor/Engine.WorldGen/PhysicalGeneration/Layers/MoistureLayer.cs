namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class MoistureLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "moisture-transport",
        0x5e29,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.OceanDistance |
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.AtmosphericFlow,
        PhysicalGeographyFacts.Moisture,
        PhysicalGeographyFacts.Precipitation |
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.None)
            {
                map.Moisture[triangleIndex] = 1000;
                continue;
            }

            var exposure = Math.Max(
                0,
                720 - (map.OceanDistance[triangleIndex] * 720 / context.Profile.OceanMoistureDistance));
            var weather = (int)Math.Round(
                PhysicalNoise.UnitNoise(
                    map.Grid.TriangleX(triangleIndex),
                    map.Grid.TriangleY(triangleIndex),
                    context.Seed,
                    31d,
                    3) * 230d,
                MidpointRounding.AwayFromZero);
            var rainShadow = map.MoistureBarriers[triangleIndex] *
                context.Profile.RainShadowStrength / 1000;
            var thaw = Math.Max(0, map.Temperature[triangleIndex] - 260) / 3;
            map.Moisture[triangleIndex] = Math.Clamp(
                80 + exposure + weather + thaw - rainShadow,
                0,
                1000);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        foreach (var value in map.Moisture)
        {
            if (value is < 0 or > 1000)
            {
                throw new InvalidOperationException("Moisture is out of range.");
            }
        }
    }

}
