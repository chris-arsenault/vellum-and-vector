namespace Engine.WorldGen;

internal sealed class DrainageGuidanceLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "drainage-guidance",
        0x61bd23,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Lakes |
        PhysicalGeographyFacts.DrainageConditioning |
        PhysicalGeographyFacts.LandscapeHistory,
        PhysicalGeographyFacts.DrainageGuidance,
        PhysicalGeographyFacts.FlowRouting |
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.RiverGeometry |
        PhysicalGeographyFacts.Floodplains |
        PhysicalGeographyFacts.Deltas |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var targets = ConditionedFlowResolver.ResolveLandTargets(
            map,
            context.Profile,
            context.Seed);
        targets.CopyTo(map.DrainageGuidanceTargets);
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var target = map.DrainageGuidanceTargets[triangleIndex];
            if (map.WaterKindCodes[triangleIndex] == Engine.Constants.PhysicalWaterKindCodes.Ocean)
            {
                if (target >= 0)
                {
                    throw new InvalidOperationException("Ocean triangle has land-drainage guidance.");
                }

                continue;
            }

            if (target < 0 || map.Grid.EdgeLeadingTo(triangleIndex, target) < 0 ||
                !ConditionedFlowResolver.IsLegalTarget(map, triangleIndex, target))
            {
                throw new InvalidOperationException("Drainage guidance selected an illegal outlet.");
            }
        }
    }
}
