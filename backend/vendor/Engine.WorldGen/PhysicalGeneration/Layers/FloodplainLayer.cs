namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class FloodplainLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "river-floodplains",
        0,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.FlowRouting |
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.RiverGeometry |
        PhysicalGeographyFacts.LandscapeHistory,
        PhysicalGeographyFacts.Floodplains,
        PhysicalGeographyFacts.Deltas | PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.FloodplainIntensity.Clear();
        var dominantUpstream = RiverChannelGeometryLayer.BuildDominantUpstream(map);
        var frontier = SeedFloodplains(map, context.Profile, dominantUpstream);
        ExpandFloodplains(map, context.Profile, dominantUpstream, frontier);
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.FloodplainIntensity[triangleIndex] is < 0 or > 1000 ||
                map.FloodplainIntensity[triangleIndex] > 0 &&
                    (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.None ||
                        map.RiverChannelStrength[triangleIndex] > 0 ||
                        map.Slope[triangleIndex] >
                            PhysicalElevation.FromUnits(context.Profile.FloodplainMaximumSlope)))
            {
                throw new InvalidOperationException("Floodplain coverage is not low, dry terrain beside a river.");
            }
        }
    }

    private static List<int> SeedFloodplains(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int[] dominantUpstream)
    {
        var frontier = new List<int>();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.RiverChannelOrders[triangleIndex] < profile.FloodplainMinimumRiverOrder)
            {
                continue;
            }

            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
                if (!CanFlood(map, profile, dominantUpstream, triangleIndex, neighbor))
                {
                    continue;
                }

                var intensity = Math.Clamp(
                    map.RiverChannelStrength[triangleIndex] +
                        PhysicalElevation.ToUnits(map.CumulativeDeposition[neighbor]) -
                        (PhysicalElevation.ToUnits(map.Slope[neighbor]) * 6),
                    1,
                    1000);
                if (intensity > map.FloodplainIntensity[neighbor])
                {
                    map.FloodplainIntensity[neighbor] = intensity;
                    frontier.Add(neighbor);
                }
            }
        }

        return frontier;
    }

    private static void ExpandFloodplains(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int[] dominantUpstream,
        List<int> frontier)
    {
        for (var step = 1; step < profile.FloodplainMaximumExpansionSteps && frontier.Count > 0; step++)
        {
            var next = new List<int>();
            foreach (var triangleIndex in frontier)
            {
                for (var edge = 0; edge < 3; edge++)
                {
                    var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
                    if (!CanFlood(map, profile, dominantUpstream, triangleIndex, neighbor))
                    {
                        continue;
                    }

                    var bankRelief = PhysicalElevation.ToUnits(
                        Math.Abs(map.Elevation[triangleIndex] - map.Elevation[neighbor]));
                    var intensity = map.FloodplainIntensity[triangleIndex] -
                        profile.FloodplainIntensityDecay -
                        bankRelief;
                    if (intensity > map.FloodplainIntensity[neighbor])
                    {
                        map.FloodplainIntensity[neighbor] = intensity;
                        next.Add(neighbor);
                    }
                }
            }

            frontier = next;
        }
    }

    private static bool CanFlood(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int[] dominantUpstream,
        int source,
        int target) =>
        target >= 0 &&
        map.WaterKindCodes[target] == PhysicalWaterKindCodes.None &&
        map.RiverChannelStrength[target] == 0 &&
        map.DrainageBasinIds[target] == map.DrainageBasinIds[source] &&
        map.Slope[target] <= PhysicalElevation.FromUnits(profile.FloodplainMaximumSlope) &&
        Math.Abs(map.Elevation[source] - map.Elevation[target]) <=
            PhysicalElevation.FromUnits(profile.FloodplainMaximumRelief) &&
        RiverChannelGeometryLayer.LongitudinalAlignment(map, dominantUpstream, source, target) <=
            profile.FloodplainMaximumLongitudinalAlignment / 1000d;
}
