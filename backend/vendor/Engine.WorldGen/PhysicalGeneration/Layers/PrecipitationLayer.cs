namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Converts ambient moisture into rain and snow using a coherent prevailing
/// air path, ocean evaporation, orographic lift, and rain shadows.
/// </summary>
internal sealed class PrecipitationLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "precipitation",
        0x3b7d19,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.Moisture |
        PhysicalGeographyFacts.AtmosphericFlow,
        PhysicalGeographyFacts.Precipitation,
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            AirMassInfluence(map, context, triangleIndex, out var oceanEvaporation, out var barrier);
            var lift = LocalOrographicLift(map, context, triangleIndex);
            var total = Math.Clamp(
                context.Profile.PrecipitationBaseline +
                (map.Moisture[triangleIndex] * 680 / 1000) +
                (oceanEvaporation * context.Profile.CurrentEvaporationStrength / 1000) +
                (lift * context.Profile.OrographicPrecipitationStrength / 1000) -
                (barrier * context.Profile.RainShadowStrength / 1000),
                0,
                1000);
            var snowFraction = Math.Clamp(
                ((context.Profile.SnowTemperatureThreshold +
                    (context.Profile.SnowTemperatureTransition / 2) -
                    map.Temperature[triangleIndex]) * 1000) /
                context.Profile.SnowTemperatureTransition,
                0,
                1000);
            map.Snowfall[triangleIndex] = total * snowFraction / 1000;
            map.Rainfall[triangleIndex] = total - map.Snowfall[triangleIndex];
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        var variedLand = false;
        var firstLand = -1;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            ValidateTriangle(map, triangleIndex);

            if (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.None)
            {
                continue;
            }

            var total = map.Rainfall[triangleIndex] + map.Snowfall[triangleIndex];
            if (firstLand < 0)
            {
                firstLand = total;
            }
            else
            {
                variedLand |= Math.Abs(firstLand - total) > 10;
            }
        }

        if (context.Profile.ExpectNaturalDiversity && firstLand >= 0 && !variedLand)
        {
            throw new InvalidOperationException("Precipitation did not form a varied land field.");
        }
    }

    private static void ValidateTriangle(PhysicalGeographyField map, int triangleIndex)
    {
        if (map.Rainfall[triangleIndex] is < 0 or > 1000 ||
            map.Snowfall[triangleIndex] is < 0 or > 1000 ||
            map.Rainfall[triangleIndex] + map.Snowfall[triangleIndex] > 1000)
        {
            throw new InvalidOperationException("Precipitation is out of range.");
        }
    }

    private static void AirMassInfluence(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int start,
        out int oceanEvaporation,
        out int barrier)
    {
        _ = context;
        barrier = map.PrecipitationBarriers[start];
        var oceanSource = map.UpwindOceanSources[start];
        oceanEvaporation = oceanSource < 0
            ? 0
            : Math.Clamp(
                (map.OceanCurrentHeat[oceanSource] * 3 / 5) +
                (map.WaveExposure[oceanSource] * 2 / 5),
                0,
                1000);
    }

    private static int LocalOrographicLift(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int triangleIndex)
    {
        var upwind = map.UpwindTargets[triangleIndex];
        if (upwind < 0)
        {
            return 0;
        }

        return Math.Clamp(
            PhysicalElevation.ToUnits(map.Elevation[triangleIndex] - map.Elevation[upwind]) * 1000 /
                Math.Max(1, context.Profile.ElevationScale / 3),
            0,
            1000);
    }

}
