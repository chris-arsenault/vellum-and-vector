namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class DeltaFormationLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "river-delta-formation",
        0,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.FlowRouting |
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.RiverGeometry |
        PhysicalGeographyFacts.Floodplains |
        PhysicalGeographyFacts.LandscapeHistory |
        PhysicalGeographyFacts.SedimentTransport,
        PhysicalGeographyFacts.Deltas,
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.DeltaIntensity.Clear();
        var sedimentDelivery = MeasureSedimentDelivery(map);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var oceanTarget = MouthOceanTarget(map, triangleIndex);
            if (oceanTarget < 0 || !MouthQualifies(
                    map,
                    context.Profile,
                    sedimentDelivery,
                    triangleIndex,
                    oceanTarget))
            {
                continue;
            }

            BuildFan(map, context.Profile, triangleIndex, oceanTarget);
        }
    }

    private static long[] MeasureSedimentDelivery(PhysicalGeographyField map)
    {
        var delivery = new long[map.Grid.TriangleCount];
        for (var triangleIndex = 0; triangleIndex < delivery.Length; triangleIndex++)
        {
            delivery[triangleIndex] =
                map.CumulativeFluvialErosion[triangleIndex] +
                map.CumulativeGlacialErosion[triangleIndex];
        }

        foreach (var triangleIndex in FlowGraphAlgorithms.SourceToOutletOrder(map))
        {
            var target = map.FlowTargets[triangleIndex];
            if (target >= 0)
            {
                delivery[target] = checked(delivery[target] + delivery[triangleIndex]);
            }
        }

        return delivery;
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.DeltaIntensity[triangleIndex] is < 0 or > 1000 ||
                map.DeltaIntensity[triangleIndex] > 0 &&
                    (map.RiverChannelStrength[triangleIndex] <= 0 ||
                        map.RiverChannelOrders[triangleIndex] <= 0 ||
                        map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Lake ||
                        map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean &&
                            map.BathymetricZoneCodes[triangleIndex] == PhysicalBathymetricZoneCodes.DeepOcean))
            {
                throw new InvalidOperationException("Delta coverage lacks a shallow river-mouth provenance.");
            }
        }
    }

    private static int MouthOceanTarget(PhysicalGeographyField map, int triangleIndex)
    {
        if (map.RiverOrders[triangleIndex] <= 0)
        {
            return -1;
        }

        var target = map.FlowTargets[triangleIndex];
        return target >= 0 && map.WaterKindCodes[target] == PhysicalWaterKindCodes.Ocean
            ? target
            : -1;
    }

    private static bool MouthQualifies(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        long[] sedimentDelivery,
        int mouth,
        int oceanTarget) =>
        IsMajorRiver(map, profile, mouth) &&
        sedimentDelivery[mouth] >= PhysicalElevation.FromUnits(profile.DeltaMinimumSedimentDelivery) &&
        map.WaveExposure[oceanTarget] <= profile.DeltaMaximumWaveEnergy &&
        map.OceanCurrentStrength[oceanTarget] <= profile.DeltaMaximumCurrentStrength &&
        map.BathymetricZoneCodes[oceanTarget] != PhysicalBathymetricZoneCodes.DeepOcean;

    private static bool IsMajorRiver(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int mouth) =>
        map.RiverOrders[mouth] >= profile.DeltaMinimumRiverOrder ||
        map.FlowAccumulation[mouth] >=
            (long)profile.RiverAccumulationThreshold * profile.DeltaDischargeMultiplier;

    private static void BuildFan(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        int mouth,
        int oceanTarget)
    {
        var directionX = map.Grid.TriangleX(oceanTarget) - map.Grid.TriangleX(mouth);
        var directionY = map.Grid.TriangleY(oceanTarget) - map.Grid.TriangleY(mouth);
        var length = MathF.Max(0.001f, MathF.Sqrt((directionX * directionX) + (directionY * directionY)));
        directionX /= length;
        directionY /= length;
        var order = map.RiverOrders[mouth];
        MarkDelta(map, mouth, 1000, order);
        var queue = new Queue<DeltaFront>();
        queue.Enqueue(new DeltaFront(oceanTarget, 1, mouth));
        while (queue.TryDequeue(out var front))
        {
            if (!CanReceiveDelta(map, mouth, front.TriangleIndex))
            {
                continue;
            }

            var intensity = 1000 - (front.Depth * profile.DeltaIntensityDecay);
            if (intensity <= map.DeltaIntensity[front.TriangleIndex])
            {
                continue;
            }

            MarkDelta(map, front.TriangleIndex, intensity, order);
            if (front.Depth >= profile.DeltaMaximumExpansionSteps)
            {
                continue;
            }

            for (var edge = 0; edge < 3; edge++)
            {
                var neighbor = map.Grid.NeighborTriangleIndex(front.TriangleIndex, edge);
                if (neighbor < 0 || neighbor == front.Previous ||
                    !PointsIntoFan(
                        map,
                        front.TriangleIndex,
                        neighbor,
                        directionX,
                        directionY,
                        profile.DeltaMinimumForwardAlignment))
                {
                    continue;
                }

                queue.Enqueue(new DeltaFront(neighbor, front.Depth + 1, front.TriangleIndex));
            }
        }
    }

    private static bool CanReceiveDelta(PhysicalGeographyField map, int mouth, int triangleIndex) =>
        map.WaterKindCodes[triangleIndex] != PhysicalWaterKindCodes.Lake &&
        (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean
            ? map.BathymetricZoneCodes[triangleIndex] != PhysicalBathymetricZoneCodes.DeepOcean
            : map.DrainageBasinIds[triangleIndex] == map.DrainageBasinIds[mouth]);

    private static bool PointsIntoFan(
        PhysicalGeographyField map,
        int source,
        int target,
        float directionX,
        float directionY,
        int minimumForwardAlignment)
    {
        var stepX = map.Grid.TriangleX(target) - map.Grid.TriangleX(source);
        var stepY = map.Grid.TriangleY(target) - map.Grid.TriangleY(source);
        var length = MathF.Max(0.001f, MathF.Sqrt((stepX * stepX) + (stepY * stepY)));
        return ((stepX * directionX) + (stepY * directionY)) / length >=
            minimumForwardAlignment / 1000f;
    }

    private static void MarkDelta(PhysicalGeographyField map, int triangleIndex, int intensity, int order)
    {
        map.DeltaIntensity[triangleIndex] = Math.Clamp(intensity, 1, 1000);
        map.RiverChannelStrength[triangleIndex] = Math.Max(
            map.RiverChannelStrength[triangleIndex],
            map.DeltaIntensity[triangleIndex]);
        map.RiverChannelOrders[triangleIndex] = Math.Max(map.RiverChannelOrders[triangleIndex], order);
        map.FloodplainIntensity[triangleIndex] = 0;
    }

    private readonly record struct DeltaFront(int TriangleIndex, int Depth, int Previous);
}
