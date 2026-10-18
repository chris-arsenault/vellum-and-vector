namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class PhysicalGeographyValidationLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "physical-structural-validation",
        0,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.DrainageConditioning |
        PhysicalGeographyFacts.Lakes |
        PhysicalGeographyFacts.FlowRouting |
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.IceFlow |
        PhysicalGeographyFacts.SeaIce |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Impacts |
        PhysicalGeographyFacts.VolcanicConstruction |
        PhysicalGeographyFacts.LandscapeHistory |
        PhysicalGeographyFacts.SedimentTransport |
        PhysicalGeographyFacts.GlacialEvolution |
        PhysicalGeographyFacts.CoastalEvolution |
        PhysicalGeographyFacts.RiverGeometry |
        PhysicalGeographyFacts.Floodplains |
        PhysicalGeographyFacts.Deltas,
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        ValidateCodes(map);
        ValidateWater(map);
        _ = FlowGraphAlgorithms.SourceToOutletOrder(map);
        ValidateRivers(map);
        ValidateGroundedIce(map, context.Profile);
        LandscapeSurface.Validate(map);
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = map;
        _ = context;
    }

    private static void ValidateCodes(PhysicalGeographyField map)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (!PrimitiveCodesAreValid(map, triangleIndex))
            {
                throw new InvalidOperationException("Physical geography contains an invalid primitive code.");
            }

            if (!RiverGeometryCodesAreValid(map, triangleIndex))
            {
                throw new InvalidOperationException("Physical geography contains an invalid river-geometry value.");
            }
        }
    }

    private static bool PrimitiveCodesAreValid(PhysicalGeographyField map, int triangleIndex) =>
        map.LandformCodes[triangleIndex] is >= PhysicalLandformCodes.Min and <= PhysicalLandformCodes.Max &&
        map.WaterKindCodes[triangleIndex] is >= PhysicalWaterKindCodes.Min and <= PhysicalWaterKindCodes.Max &&
        map.BathymetricZoneCodes[triangleIndex] is >= PhysicalBathymetricZoneCodes.Min and
            <= PhysicalBathymetricZoneCodes.Max &&
        (map.FeatureFlags[triangleIndex] & ~PhysicalGeographyFeatureCodes.All) == 0;

    private static bool RiverGeometryCodesAreValid(PhysicalGeographyField map, int triangleIndex) =>
        map.RiverChannelStrength[triangleIndex] is >= 0 and <= 1000 &&
        map.RiverChannelOrders[triangleIndex] >= 0 &&
        map.FloodplainIntensity[triangleIndex] is >= 0 and <= 1000 &&
        map.DeltaIntensity[triangleIndex] is >= 0 and <= 1000;

    private static void ValidateWater(PhysicalGeographyField map)
    {
        var ocean = 0;
        var lakeSurfaces = new Dictionary<int, long>();
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            ValidateWaterState(map, triangleIndex);
            if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean)
            {
                ocean++;
                ValidateOceanTriangle(map, triangleIndex);
            }
            else if (map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Lake)
            {
                ValidateLakeTriangle(map, lakeSurfaces, triangleIndex);
            }
        }

        if (ocean == 0)
        {
            throw new InvalidOperationException("Physical geography contains no connected ocean.");
        }
    }

    private static void ValidateWaterState(PhysicalGeographyField map, int triangleIndex)
    {
        var dry = map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.None;
        if (dry != (map.WaterSurfaceElevations[triangleIndex] == long.MinValue) ||
            dry != (map.WaterDepths[triangleIndex] == 0))
        {
            throw new InvalidOperationException("Physical water surface and depth disagree.");
        }

        if (!dry && map.WaterSurfaceElevations[triangleIndex] - map.Elevation[triangleIndex] !=
            map.WaterDepths[triangleIndex])
        {
            throw new InvalidOperationException("Physical water depth does not match surface minus floor.");
        }
    }

    private static void ValidateOceanTriangle(PhysicalGeographyField map, int triangleIndex)
    {
        if (map.WaterBodyIds[triangleIndex] != 1 || map.WaterDepths[triangleIndex] <= 0)
        {
            throw new InvalidOperationException("Ocean triangle lacks depth or body identity.");
        }
    }

    private static void ValidateLakeTriangle(
        PhysicalGeographyField map,
        Dictionary<int, long> lakeSurfaces,
        int triangleIndex)
    {
        var bodyId = map.WaterBodyIds[triangleIndex];
        var surface = map.WaterSurfaceElevations[triangleIndex];
        if (bodyId <= 1 || map.WaterDepths[triangleIndex] <= 0 ||
            (!lakeSurfaces.TryAdd(bodyId, surface) && lakeSurfaces[bodyId] != surface))
        {
            throw new InvalidOperationException("Lake triangle lacks a consistent water surface.");
        }
    }

    private static void ValidateRivers(PhysicalGeographyField map)
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
                throw new InvalidOperationException("River network does not continue toward an outlet.");
            }
        }
    }

    private static void ValidateGroundedIce(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.GroundedIce[triangleIndex] is < 0 or > 1 ||
                map.GroundedIce[triangleIndex] != 0 &&
                    !GlacierSurface.IsGrounded(map, triangleIndex, profile) ||
                map.MaximumGroundedIceFlux[triangleIndex] > map.MaximumIceFlux[triangleIndex])
            {
                throw new InvalidOperationException("Grounded-ice history contradicts physical support.");
            }
        }
    }

}
