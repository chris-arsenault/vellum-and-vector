namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>Adds the independently derived glacial water source to rainfall runoff.</summary>
internal sealed class GlacialRunoffLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "glacial-runoff",
        0,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.GlacialMeltwater,
        PhysicalGeographyFacts.Runoff,
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
            if (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.None)
            {
                map.Runoff[triangleIndex] = 0;
                continue;
            }

            var meltwater = map.GlacialMeltwater[triangleIndex] *
                context.HydrologyStrength / 1000;
            map.Runoff[triangleIndex] = Math.Clamp(
                map.Runoff[triangleIndex] + meltwater,
                0,
                1000);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.Runoff[triangleIndex] is < 0 or > 1000 ||
                map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.None &&
                map.Runoff[triangleIndex] != 0)
            {
                throw new InvalidOperationException("Glacial runoff is out of range.");
            }
        }
    }
}
