namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Returns exported sediment to accommodation space on passive and rifted
/// continental margins. This redistributes the existing sediment budget; it
/// does not create fill merely to satisfy a bathymetric profile.
/// </summary>
internal sealed class MarineSedimentationLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "marine-sedimentation",
        0,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.LandscapeHistory |
        PhysicalGeographyFacts.TectonicMargins,
        PhysicalGeographyFacts.Elevation | PhysicalGeographyFacts.LandscapeHistory,
        PhysicalGeographyFacts.CrustalSupport |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.OceanDistance |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        if (map.SedimentExportedTotal <= 0)
        {
            return;
        }

        var capacities = new long[map.Grid.TriangleCount];
        var totalCapacity = MeasureCapacity(map, context.Profile, capacities);
        var remaining = Math.Min(map.SedimentExportedTotal, totalCapacity);
        var deposited = DepositProportionally(map, capacities, totalCapacity, remaining);
        map.SedimentExportedTotal = checked(map.SedimentExportedTotal - deposited);
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        LandscapeSurface.Validate(map);
    }

    private static long MeasureCapacity(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile,
        long[] capacities)
    {
        long total = 0;
        for (var triangleIndex = 0; triangleIndex < capacities.Length; triangleIndex++)
        {
            var margin = map.CoastalMarginCodes[triangleIndex];
            var distance = map.OceanMarginDistance[triangleIndex];
            var shelfWidth = margin == PhysicalMarginCodes.Passive
                ? profile.PassiveShelfWidth
                : profile.RiftedShelfWidth;
            var maximumStep = margin == PhysicalMarginCodes.Passive
                ? profile.PassiveMarginMaximumStep
                : profile.RiftedMarginMaximumStep;
            var representativeBasinDepth = profile.OceanicSubsidenceDepth +
                Math.Abs(PhysicalCrust.OceanicFoundationHeightUnits);
            var riseReach = profile.ContinentalRiseMinimumWidth + (int)Math.Ceiling(
                Math.Max(0, representativeBasinDepth - profile.ContinentalShelfDepth) /
                    (double)maximumStep);
            if (distance <= 0 || distance > shelfWidth + riseReach ||
                margin is not (PhysicalMarginCodes.Passive or PhysicalMarginCodes.Rifted))
            {
                continue;
            }

            var reach = shelfWidth + riseReach;
            var influence = Math.Clamp(1d - ((distance - 1d) / reach), 0d, 1d);
            influence = influence * influence * (3d - (2d * influence));
            var target = PhysicalElevation.FromUnits(
                profile.MarineSedimentCapacity * influence *
                (margin == PhysicalMarginCodes.Rifted ? 0.72d : 1d));
            capacities[triangleIndex] = Math.Max(
                0,
                target - map.SedimentThickness[triangleIndex]);
            total = checked(total + capacities[triangleIndex]);
        }

        return total;
    }

    private static long DepositProportionally(
        PhysicalGeographyField map,
        ReadOnlySpan<long> capacities,
        long totalCapacity,
        long budget)
    {
        long deposited = 0;
        var remainingCapacity = totalCapacity;
        var remainingBudget = budget;
        for (var triangleIndex = 0; triangleIndex < capacities.Length; triangleIndex++)
        {
            var capacity = capacities[triangleIndex];
            if (capacity <= 0 || remainingBudget <= 0)
            {
                remainingCapacity -= capacity;
                continue;
            }

            var amount = remainingCapacity <= 0
                ? 0
                : Math.Min(capacity, checked(remainingBudget * capacity / remainingCapacity));
            if (amount > 0)
            {
                deposited = checked(deposited + LandscapeSurface.Deposit(map, triangleIndex, amount));
                remainingBudget -= amount;
            }

            remainingCapacity -= capacity;
        }

        return deposited;
    }
}
