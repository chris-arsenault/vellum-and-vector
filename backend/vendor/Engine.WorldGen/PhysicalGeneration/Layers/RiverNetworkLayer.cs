namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class RiverNetworkLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "river-network",
        0,
        PhysicalGeographyFacts.Runoff | PhysicalGeographyFacts.FlowRouting,
        PhysicalGeographyFacts.Rivers,
        PhysicalGeographyFacts.RiverGeometry |
        PhysicalGeographyFacts.Floodplains |
        PhysicalGeographyFacts.Deltas |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.FlowAccumulation.Clear();
        map.RiverOrders.Clear();
        var order = FlowGraphAlgorithms.SourceToOutletOrder(map);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            map.FlowAccumulation[triangleIndex] = map.Runoff[triangleIndex];
        }

        foreach (var triangleIndex in order)
        {
            var target = map.FlowTargets[triangleIndex];
            if (target >= 0)
            {
                map.FlowAccumulation[target] = FlowGraphAlgorithms.SaturatingAdd(
                    map.FlowAccumulation[target],
                    map.FlowAccumulation[triangleIndex]);
            }
        }

        var basinDischarge = BuildBasinMaximumDischarge(map);
        var channels = BuildChannels(map, context.Profile, basinDischarge, order);
        var lakeOutflowStarts = FindLakeOutflowStarts(map, channels);

        PruneShortHeadwaters(
            map,
            channels,
            lakeOutflowStarts,
            context.Profile);
        CompleteDownstreamChannels(map, order, channels);
        AssignStrahlerOrder(map, order, channels);
        BuildSpineEdgeMasks(map, context.Profile);
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.RiverOrders[triangleIndex] <= 0)
            {
                continue;
            }

            var target = map.FlowTargets[triangleIndex];
            if (target < 0 || map.FlowAccumulation[target] < map.FlowAccumulation[triangleIndex])
            {
                throw new InvalidOperationException("River accumulation does not continue downstream.");
            }

            ValidateContinuousOutletPath(map, triangleIndex);
        }

        ValidateSpineEdgeMasks(map, context.Profile);
    }

    private static int[] BuildBasinMaximumDischarge(PhysicalGeographyField map)
    {
        var largestBasin = 0;
        foreach (var basin in map.DrainageBasinIds)
        {
            largestBasin = Math.Max(largestBasin, basin);
        }

        var maximum = new int[largestBasin + 1];
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var basin = map.DrainageBasinIds[triangleIndex];
            if (basin > 0)
            {
                maximum[basin] = Math.Max(maximum[basin], map.FlowAccumulation[triangleIndex]);
            }
        }

        return maximum;
    }

    private static bool[] BuildChannels(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int[] basinDischarge,
        IReadOnlyList<int> sourceToOutlet)
    {
        var channels = new bool[map.Grid.TriangleCount];
        for (var triangleIndex = 0; triangleIndex < channels.Length; triangleIndex++)
        {
            if (map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.None)
            {
                continue;
            }

            var basin = map.DrainageBasinIds[triangleIndex];
            var maximum = basin > 0 && basin < basinDischarge.Length
                ? basinDischarge[basin]
                : profile.RiverAccumulationThreshold;

            // A drainage too small to be a river does not get one. Scaling the
            // threshold to each basin keeps tributaries in basins of every
            // size, which is why that rule exists, but on its own it also
            // guarantees a channel in a puddle: a fraction of a tiny maximum
            // is a tiny threshold.
            if (maximum < profile.RiverMinimumBasinDischarge)
            {
                continue;
            }

            var basinThreshold = (int)Math.Min(
                int.MaxValue,
                (long)maximum * profile.RiverBasinHeadwaterFraction / 1000L);
            var threshold = Math.Clamp(
                basinThreshold,
                profile.RiverMinimumAccumulationThreshold,
                profile.RiverAccumulationThreshold);

            // Steep ground channelises with a small catchment and flat ground
            // needs a large one, so discharge is weighed against the slope it
            // is running down rather than counted alone.
            channels[triangleIndex] =
                ChannelDischarge(map, profile, triangleIndex) >= threshold;
        }

        CompleteDownstreamChannels(map, sourceToOutlet, channels);
        return channels;
    }

    /// <summary>
    /// Discharge weighted by local gradient. Water on a slope cuts a channel
    /// with far less catchment behind it than the same water on a plain.
    /// </summary>
    private static long ChannelDischarge(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int triangleIndex)
    {
        var reference = (double)PhysicalElevation.FromUnits(profile.ChannelReferenceSlope);
        var slope = Math.Max(0d, map.Slope[triangleIndex]);
        var factor = Math.Clamp(
            Math.Sqrt(slope / Math.Max(1d, reference)),
            profile.ChannelSlopeFloor / 1000d,
            profile.ChannelSlopeCeiling / 1000d);
        return (long)(map.FlowAccumulation[triangleIndex] * factor);
    }

    private static void CompleteDownstreamChannels(
        PhysicalGeographyField map,
        IReadOnlyList<int> sourceToOutlet,
        bool[] channels)
    {
        var downstreamOfChannel = (bool[])channels.Clone();
        foreach (var triangleIndex in sourceToOutlet)
        {
            if (!downstreamOfChannel[triangleIndex])
            {
                continue;
            }

            var target = map.FlowTargets[triangleIndex];
            if (target < 0)
            {
                continue;
            }

            downstreamOfChannel[target] = true;
            if (map.WaterKindCodes[target] == PhysicalWaterKindCodes.None)
            {
                channels[target] = true;
            }
        }
    }

    private static bool[] FindLakeOutflowStarts(PhysicalGeographyField map, bool[] channels)
    {
        var outflowStarts = new bool[channels.Length];
        for (var triangleIndex = 0; triangleIndex < channels.Length; triangleIndex++)
        {
            var target = map.FlowTargets[triangleIndex];
            if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Lake &&
                target >= 0 && channels[target])
            {
                outflowStarts[target] = true;
            }
        }

        return outflowStarts;
    }

    private static void ValidateContinuousOutletPath(PhysicalGeographyField map, int source)
    {
        var current = source;
        for (var step = 0; step <= map.Grid.TriangleCount; step++)
        {
            var target = map.FlowTargets[current];
            if (target < 0)
            {
                if (map.WaterKindCodes[current] is PhysicalWaterKindCodes.Ocean or PhysicalWaterKindCodes.Lake)
                {
                    return;
                }

                throw new InvalidOperationException("River channel terminates before reaching water.");
            }

            if (map.WaterKindCodes[target] == PhysicalWaterKindCodes.None &&
                map.RiverOrders[target] <= 0)
            {
                throw new InvalidOperationException(
                    $"River channel {source} contains a downstream break from {current} to {target}; " +
                    $"source basin={map.DrainageBasinIds[source]}, current water=" +
                    $"{map.WaterKindCodes[current]}, target basin={map.DrainageBasinIds[target]}.");
            }

            current = target;
        }

        throw new InvalidOperationException("River channel outlet path contains a cycle.");
    }

    private static void PruneShortHeadwaters(
        PhysicalGeographyField map,
        bool[] channels,
        bool[] protectedHeadwaters,
        PhysicalGeographyGenerationProfile profile)
    {
        var incoming = ChannelIncomingCounts(map, channels);
        for (var triangleIndex = 0; triangleIndex < channels.Length; triangleIndex++)
        {
            if (!channels[triangleIndex] || incoming[triangleIndex] != 0 ||
                protectedHeadwaters[triangleIndex])
            {
                continue;
            }

            var reach = CollectHeadwaterReach(
                map,
                channels,
                incoming,
                protectedHeadwaters,
                triangleIndex);
            if (reach.Count < profile.MinimumRiverReachTriangles &&
                !ShortReachIsSupported(map, channels, incoming, reach, profile))
            {
                foreach (var member in reach)
                {
                    channels[member] = false;
                }
            }
        }
    }

    private static bool ShortReachIsSupported(
        PhysicalGeographyField map,
        bool[] channels,
        int[] incoming,
        List<int> reach,
        PhysicalGeographyGenerationProfile profile)
    {
        var headwater = reach[0];
        var last = reach[^1];
        var target = map.FlowTargets[last];
        var joinsConfluence = target >= 0 && channels[target] && incoming[target] > 1;
        return joinsConfluence ||
            map.FlowAccumulation[headwater] >= profile.RiverAccumulationThreshold;
    }

    private static List<int> CollectHeadwaterReach(
        PhysicalGeographyField map,
        bool[] channels,
        int[] incoming,
        bool[] protectedHeadwaters,
        int headwater)
    {
        var reach = new List<int>();
        var current = headwater;
        while (current >= 0 && channels[current] && incoming[current] <= 1)
        {
            reach.Add(current);
            var target = map.FlowTargets[current];
            if (target < 0 || !channels[target] || incoming[target] > 1 ||
                protectedHeadwaters[target])
            {
                break;
            }

            current = target;
        }

        return reach;
    }

    private static int[] ChannelIncomingCounts(PhysicalGeographyField map, bool[] channels)
    {
        var incoming = new int[channels.Length];
        for (var triangleIndex = 0; triangleIndex < channels.Length; triangleIndex++)
        {
            var target = map.FlowTargets[triangleIndex];
            if (channels[triangleIndex] && target >= 0 && channels[target])
            {
                incoming[target]++;
            }
        }

        return incoming;
    }

    private static void AssignStrahlerOrder(
        PhysicalGeographyField map,
        IReadOnlyList<int> sourceToOutlet,
        bool[] channels)
    {
        var largestIncoming = new int[channels.Length];
        var largestCount = new int[channels.Length];
        foreach (var triangleIndex in sourceToOutlet)
        {
            // Lakes are conduits for stream order: a river system that flows
            // through a chain of lakes keeps accumulating order instead of
            // restarting at one below every pond.
            var isLakeConduit = !channels[triangleIndex] &&
                map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Lake &&
                largestIncoming[triangleIndex] > 0;
            if (!channels[triangleIndex] && !isLakeConduit)
            {
                continue;
            }

            var order = CalculateStrahlerOrder(
                largestIncoming[triangleIndex],
                largestCount[triangleIndex]);
            if (channels[triangleIndex])
            {
                map.RiverOrders[triangleIndex] = order;
            }

            var target = map.FlowTargets[triangleIndex];
            if (target < 0)
            {
                continue;
            }

            if (order > largestIncoming[target])
            {
                largestIncoming[target] = order;
                largestCount[target] = 1;
            }
            else if (order == largestIncoming[target])
            {
                largestCount[target]++;
            }
        }
    }

    private static int CalculateStrahlerOrder(int largestIncoming, int largestCount)
    {
        if (largestIncoming == 0)
        {
            return 1;
        }

        return largestCount >= 2 ? largestIncoming + 1 : largestIncoming;
    }

    private static void BuildSpineEdgeMasks(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile)
    {
        map.RiverSpineEdgeMasks.Clear();
        for (var source = 0; source < map.Grid.TriangleCount; source++)
        {
            var target = map.FlowTargets[source];
            if (target >= 0 && CarriesVisibleSpine(map, profile, source, target))
            {
                AddSpineEdge(map, source, target);
            }
        }
    }

    private static bool CarriesVisibleSpine(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int source,
        int target) =>
        map.RiverOrders[source] > 0 ||

        // A lake triangle draws a spine only where it hands off to a channel,
        // so a river reads as continuous through the lake without the open
        // water itself being veined with rivers.
        map.WaterKindCodes[source] == PhysicalWaterKindCodes.Lake &&
            map.WaterKindCodes[target] != PhysicalWaterKindCodes.Lake &&
            map.RiverOrders[target] > 0;

    private static void AddSpineEdge(PhysicalGeographyField map, int source, int target)
    {
        var sourceEdge = map.Grid.EdgeLeadingTo(source, target);
        var targetEdge = map.Grid.EdgeLeadingTo(target, source);
        if (sourceEdge < 0 || targetEdge < 0)
        {
            throw new InvalidOperationException("River spine contains a non-adjacent segment.");
        }

        map.RiverSpineEdgeMasks[source] |= 1 << sourceEdge;
        map.RiverSpineEdgeMasks[target] |= 1 << targetEdge;
    }

    private static void ValidateSpineEdgeMasks(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile)
    {
        for (var source = 0; source < map.Grid.TriangleCount; source++)
        {
            var expected = 0;
            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = map.Grid.NeighborTriangleIndex(source, edge);
                if (neighbor >= 0 &&
                    (map.FlowTargets[source] == neighbor &&
                            CarriesVisibleSpine(map, profile, source, neighbor) ||
                        map.FlowTargets[neighbor] == source &&
                            CarriesVisibleSpine(map, profile, neighbor, source)))
                {
                    expected |= 1 << edge;
                }
            }

            if (map.RiverSpineEdgeMasks[source] != expected)
            {
                throw new InvalidOperationException("River spine edge coverage is discontinuous.");
            }
        }
    }
}
