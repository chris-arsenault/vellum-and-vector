namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Derives current meltwater from surface ablation, geothermal basal melt, and
/// retreat from the maximum recorded ice extent. This is a water source, not a
/// flow router; ordinary drainage remains authoritative downstream.
/// </summary>
internal sealed class GlacialMeltwaterLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "glacial-meltwater",
        0,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.Geothermal |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.IceFlow |
        PhysicalGeographyFacts.Lakes,
        PhysicalGeographyFacts.GlacialMeltwater,
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.Lakes |
        PhysicalGeographyFacts.FlowRouting |
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.RiverGeometry |
        PhysicalGeographyFacts.Floodplains |
        PhysicalGeographyFacts.Deltas |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            map.GlacialMeltwater[triangleIndex] =
                map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.None
                    ? Meltwater(map, triangleIndex, context.Profile)
                    : 0;
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var value = map.GlacialMeltwater[triangleIndex];
            if (value is < 0 or > 1000 ||
                map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.None && value != 0)
            {
                throw new InvalidOperationException("Glacial meltwater is inconsistent with the ice field.");
            }
        }
    }

    private static int Meltwater(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile)
    {
        var ice = map.IceThickness[triangleIndex];
        var maximumIce = map.MaximumIceThickness[triangleIndex];
        var thawRange = Math.Max(1, profile.IceTemperatureThreshold -
            profile.GlacialMeltTemperatureFloor);
        var thaw = Math.Clamp(
            (map.Temperature[triangleIndex] - profile.GlacialMeltTemperatureFloor) * 1000 /
                thawRange,
            0,
            1000);
        var surfaceAblation = ice * thaw / 1000 * profile.GlacialAblationRunoffStrength / 1000;
        var basalMelt = ice * map.Geothermal[triangleIndex] / 1000 *
            profile.BasalMeltRunoffStrength / 1000;
        var retreat = Math.Max(0, maximumIce - ice) * profile.GlacialRetreatRunoffStrength / 1000;
        return Math.Clamp(surfaceAblation + basalMelt + retreat, 0, 1000);
    }
}
