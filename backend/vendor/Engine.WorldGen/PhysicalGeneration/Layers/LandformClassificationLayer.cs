namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class LandformClassificationLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "landform-classification",
        0,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Lakes |
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.GlacialRelief |
        PhysicalGeographyFacts.LandscapeHistory |
        PhysicalGeographyFacts.Impacts |
        PhysicalGeographyFacts.VolcanicConstruction,
        PhysicalGeographyFacts.Landforms,
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        BathymetryLayer.MeasureSlopes(map);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            map.LandformCodes[triangleIndex] = ClassifyTriangle(map, triangleIndex, context.Profile);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        foreach (var code in map.LandformCodes)
        {
            if (code is < PhysicalLandformCodes.Min or > PhysicalLandformCodes.Max)
            {
                throw new InvalidOperationException("Landform classification produced an invalid code.");
            }
        }
    }

    private static int ClassifyTriangle(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile)
    {
        var shape = MeasureShape(map, triangleIndex);
        var retained = RetainedPhysicalLandform(map, triangleIndex, profile);
        if (retained != 0)
        {
            return retained;
        }

        var historical = HistoricalLandform(map, triangleIndex, profile, shape);
        if (historical != 0)
        {
            return historical;
        }

        if (IsWaterfall(map, triangleIndex, profile))
        {
            return PhysicalLandformCodes.Waterfall;
        }

        if (IsGorge(map, triangleIndex, profile))
        {
            return PhysicalLandformCodes.Gorge;
        }

        if (IsPeak(map, triangleIndex, profile, shape))
        {
            return PhysicalLandformCodes.Peak;
        }

        if (IsPass(map, triangleIndex, profile, shape))
        {
            return PhysicalLandformCodes.Pass;
        }

        if (IsRidge(map, triangleIndex, profile))
        {
            return PhysicalLandformCodes.Ridge;
        }

        if (IsValley(map, triangleIndex, profile, shape))
        {
            return PhysicalLandformCodes.Valley;
        }

        return map.Slope[triangleIndex] <= PhysicalElevation.FromUnits(profile.PlainSlopeThreshold)
            ? PhysicalLandformCodes.Plain
            : PhysicalLandformCodes.Slope;
    }

    /// <summary>
    /// A waterfall spans the river. Testing each triangle against its own
    /// outflow made the fall a property of one triangle, so on a river two or
    /// three triangles wide only the ones whose own target happened to sit
    /// below the lip qualified - leaving a waterfall on one bank and a gorge
    /// on the other. Water does not fall on the left side of a river only.
    /// </summary>
    private static bool IsWaterfall(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile)
    {
        if (map.RiverOrders[triangleIndex] <= 0)
        {
            return false;
        }

        if (HasWaterfallDrop(map, triangleIndex, profile))
        {
            return true;
        }

        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
            if (neighbor >= 0 &&
                map.RiverOrders[neighbor] >= map.RiverOrders[triangleIndex] &&
                HasWaterfallDrop(map, neighbor, profile))
            {
                return true;
            }
        }

        return false;
    }

    private static bool HasWaterfallDrop(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile)
    {
        var target = map.FlowTargets[triangleIndex];
        if (target < 0)
        {
            return false;
        }

        var drop = map.Elevation[triangleIndex] - map.Elevation[target];
        return drop >= PhysicalElevation.FromUnits(profile.WaterfallMinimumDrop);
    }

    private static bool IsGorge(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile) =>
        map.RiverOrders[triangleIndex] > 0 &&
        map.Slope[triangleIndex] >= PhysicalElevation.FromUnits(profile.GorgeMinimumSlope) &&
        map.CumulativeFluvialErosion[triangleIndex] >=
            PhysicalElevation.FromUnits(profile.GorgeMinimumIncision);

    private static bool IsPeak(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile,
        NeighborShape shape) =>
        map.Elevation[triangleIndex] >= PhysicalElevation.FromUnits(profile.PeakElevationThreshold) &&
        shape.LowerNeighbors >= 2 &&
        map.Elevation[triangleIndex] - shape.HighestNeighbor >=
            PhysicalElevation.FromUnits(profile.PeakProminenceThreshold);

    private static bool IsPass(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile,
        NeighborShape shape) =>
        map.Elevation[triangleIndex] >= PhysicalElevation.FromUnits(profile.RidgeElevationThreshold) &&
        map.RidgeInfluence[triangleIndex] >= 0.34f &&
        shape.HigherNeighbors >= 2 && shape.LowerNeighbors >= 1;

    private static bool IsRidge(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile) =>
        map.Elevation[triangleIndex] >= PhysicalElevation.FromUnits(profile.RidgeElevationThreshold) &&
        map.Slope[triangleIndex] >= PhysicalElevation.FromUnits(profile.RidgeSlopeThreshold) &&
        (map.RidgeInfluence[triangleIndex] >= 0.26f || map.Uplift[triangleIndex] >= 0.42f ||
            map.TectonicActivityHistory[triangleIndex] >= profile.InheritedRidgeActivityThreshold);

    private static bool IsValley(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile,
        NeighborShape shape) =>
        map.RiverOrders[triangleIndex] > 0 ||
        map.CumulativeFluvialErosion[triangleIndex] >=
            PhysicalElevation.FromUnits(profile.AncestralValleyMinimumErosion) ||
        (shape.HigherNeighbors >= 2 &&
            map.Slope[triangleIndex] > PhysicalElevation.FromUnits(profile.PlainSlopeThreshold) &&
            map.FlowAccumulation[triangleIndex] >= profile.RiverAccumulationThreshold / 3);

    private static int HistoricalLandform(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile,
        NeighborShape shape)
    {
        if (map.ImpactRimUplift[triangleIndex] >=
                PhysicalElevation.FromUnits(profile.ImpactLandformMinimumRimUplift) &&
            map.ImpactRimUplift[triangleIndex] * 2 > map.ImpactExcavation[triangleIndex])
        {
            return PhysicalLandformCodes.ImpactRim;
        }

        if (map.ImpactExcavation[triangleIndex] >=
                PhysicalElevation.FromUnits(profile.ImpactLandformMinimumExcavation) &&
            shape.HigherNeighbors >= 2)
        {
            return PhysicalLandformCodes.ImpactBasin;
        }

        return map.CumulativeGlacialDeposition[triangleIndex] >=
                PhysicalElevation.FromUnits(profile.OutwashMinimumGlacialDeposition) &&
            map.Slope[triangleIndex] <= PhysicalElevation.FromUnits(profile.PlainSlopeThreshold)
                ? PhysicalLandformCodes.OutwashPlain
                : 0;
    }

    private static int RetainedPhysicalLandform(
        PhysicalGeographyField map,
        int triangleIndex,
        PhysicalGeographyGenerationProfile profile)
    {
        var glacial = map.LandformCodes[triangleIndex];
        if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean)
        {
            // A fjord is a glacial valley the sea has drowned. Glacial
            // landform classification skips water, so a valley that ended up
            // below sea level never carried a UValley code and this branch was
            // unreachable: the carving history is the durable evidence, not
            // the transient code.
            if (glacial is PhysicalLandformCodes.UValley or PhysicalLandformCodes.Cirque ||
                map.CumulativeGlacialErosion[triangleIndex] >=
                    PhysicalElevation.FromUnits(profile.FjordMinimumGlacialErosion))
            {
                return PhysicalLandformCodes.Fjord;
            }

            return PhysicalLandformCodes.Seabed;
        }

        if (glacial is PhysicalLandformCodes.UValley or
            PhysicalLandformCodes.Cirque or PhysicalLandformCodes.Moraine)
        {
            return glacial;
        }

        return map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Lake
            ? PhysicalLandformCodes.Basin
            : 0;
    }

    private static NeighborShape MeasureShape(PhysicalGeographyField map, int triangleIndex)
    {
        var higher = 0;
        var lower = 0;
        var highest = long.MinValue;
        var elevation = map.Elevation[triangleIndex];
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
            if (neighbor < 0)
            {
                continue;
            }

            var neighborElevation = map.Elevation[neighbor];
            higher += neighborElevation > elevation ? 1 : 0;
            lower += neighborElevation < elevation ? 1 : 0;
            highest = Math.Max(highest, neighborElevation);
        }

        return new NeighborShape(higher, lower, highest);
    }

    private readonly record struct NeighborShape(
        int HigherNeighbors,
        int LowerNeighbors,
        long HighestNeighbor);
}
