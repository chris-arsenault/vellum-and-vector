namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class IceFlowLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "ice-flow",
        0,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.Lakes,
        PhysicalGeographyFacts.IceFlow,
        PhysicalGeographyFacts.GlacialMeltwater |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.IceFlux.Clear();
        map.IceFlowTargets.Fill(-1);
        GlacierSurface.RefreshGrounding(map, context.Profile);
        var surface = BuildSupportedSurface(map);
        AssignFlowTargets(map, surface);
        AccumulateFlux(map, surface);
        RecordFluxHistory(map);
    }

    private static long[] BuildSupportedSurface(PhysicalGeographyField map)
    {
        var surface = new long[map.Grid.TriangleCount];
        for (var triangleIndex = 0; triangleIndex < surface.Length; triangleIndex++)
        {
            surface[triangleIndex] = GlacierSurface.SupportElevation(map, triangleIndex) +
                PhysicalElevation.FromUnits(map.IceThickness[triangleIndex] / 3d);
            map.IceFlux[triangleIndex] = map.IceThickness[triangleIndex];
        }

        return surface;
    }

    private static void AssignFlowTargets(PhysicalGeographyField map, long[] surface)
    {
        for (var triangleIndex = 0; triangleIndex < surface.Length; triangleIndex++)
        {
            if (!GlacierSurface.CanCarryLandIce(map, triangleIndex))
            {
                continue;
            }

            var best = -1;
            var bestSlope = 0d;
            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
                if (neighbor < 0 || surface[neighbor] >= surface[triangleIndex])
                {
                    continue;
                }

                var slope = surface[triangleIndex] - surface[neighbor];
                if (slope > bestSlope)
                {
                    best = neighbor;
                    bestSlope = slope;
                }
            }

            map.IceFlowTargets[triangleIndex] = best;
        }
    }

    private static void AccumulateFlux(PhysicalGeographyField map, long[] surface)
    {
        var order = IntegerKeyOrdering.DescendingThenIndex(surface);
        foreach (var triangleIndex in order)
        {
            var target = map.IceFlowTargets[triangleIndex];
            if (target >= 0)
            {
                map.IceFlux[target] = FlowGraphAlgorithms.SaturatingAdd(
                    map.IceFlux[target],
                    map.IceFlux[triangleIndex]);
            }
        }
    }

    private static void RecordFluxHistory(PhysicalGeographyField map)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            map.MaximumIceFlux[triangleIndex] = Math.Max(
                map.MaximumIceFlux[triangleIndex],
                map.IceFlux[triangleIndex]);
            if (map.GroundedIce[triangleIndex] != 0)
            {
                map.MaximumGroundedIceFlux[triangleIndex] = Math.Max(
                    map.MaximumGroundedIceFlux[triangleIndex],
                    map.IceFlux[triangleIndex]);
            }
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.IceFlux[triangleIndex] < map.IceThickness[triangleIndex])
            {
                throw new InvalidOperationException("Ice flux lost local accumulated ice.");
            }

            if (map.GroundedIce[triangleIndex] is < 0 or > 1 ||
                map.GroundedIce[triangleIndex] != 0 &&
                    !GlacierSurface.IsGrounded(map, triangleIndex, context.Profile))
            {
                throw new InvalidOperationException("Ice grounding contradicts the physical support surface.");
            }
        }
    }
}
