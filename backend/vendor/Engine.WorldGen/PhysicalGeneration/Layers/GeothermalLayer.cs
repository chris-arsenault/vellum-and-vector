namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class GeothermalLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "geothermal",
        0x152b37,
        PhysicalGeographyFacts.TectonicProvinces |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Fractures |
        PhysicalGeographyFacts.VolcanicConstruction,
        PhysicalGeographyFacts.Geothermal,
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.Warmth |
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.Moisture |
        PhysicalGeographyFacts.Precipitation |
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            map.FeatureFlags[triangleIndex] &= ~PhysicalGeographyFeatureCodes.GeothermalVent;
            var strain = map.TectonicStrain[triangleIndex] / 1000d;
            var boundaryHeat = map.TectonicBoundaryCodes[triangleIndex] switch
            {
                PhysicalTectonicBoundaryCodes.Divergent => strain * 0.58d,
                PhysicalTectonicBoundaryCodes.Convergent => strain * 0.43d,
                PhysicalTectonicBoundaryCodes.Transform => strain * 0.24d,
                _ => 0d,
            };
            var fractureHeat = map.FractureConductance[triangleIndex] / 1000d * 0.28d;
            var impactHeat = map.ImpactHeat[triangleIndex] / 1000d * 0.36d /
                Math.Max(1, map.CompletedEpochCount + 1);
            // A plume halo spread as a clean radial falloff reads as a disc,
            // and the seafloor features that key off it inherit that shape.
            // Real plumes are sheared and lobed by the mantle they rise
            // through, so the halo is broken up rather than being a circle
            // with a smooth edge.
            var plumeHeat = map.VolcanicActivity[triangleIndex] / 1000d * 0.68d *
                PlumeLobes(map, context, triangleIndex);
            var broad = PhysicalNoise.UnitNoise(
                map.Grid.TriangleX(triangleIndex),
                map.Grid.TriangleY(triangleIndex),
                context.Seed,
                Math.Max(14d, map.Grid.ContentRadius * 0.34d),
                2) * 0.10d;
            map.Geothermal[triangleIndex] = ScaleUnit(
                boundaryHeat + fractureHeat + impactHeat + plumeHeat + broad);
        }

        ClassifyHeatSources(map, context.Profile);
    }

    private static double PlumeLobes(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int triangleIndex)
    {
        var lobes = PhysicalNoise.FractalNoise(
            map.Grid.TriangleX(triangleIndex),
            map.Grid.TriangleY(triangleIndex),
            context.Seed ^ 0x4d13,
            context.Profile.PlumeLobeScale,
            3);
        return Math.Clamp(
            1d + (lobes * context.Profile.PlumeLobeStrength / 1000d),
            0d,
            1.6d);
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        var vents = 0;
        var groundedVents = 0;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.Geothermal[triangleIndex] is < 0 or > 1000)
            {
                throw new InvalidOperationException("Geothermal intensity is out of range.");
            }

            if ((map.FeatureFlags[triangleIndex] & PhysicalGeographyFeatureCodes.GeothermalVent) == 0)
            {
                continue;
            }

            vents++;
            groundedVents += VentHasProvenance(map, triangleIndex) ? 1 : 0;
        }

        if (groundedVents != vents)
        {
            throw new InvalidOperationException(
                $"Geothermal vent validation failed in epoch {context.EpochIndex}: " +
                $"{vents} vents, {groundedVents} with tectonic, fracture, or plume provenance.");
        }
    }

    private static bool VentHasProvenance(PhysicalGeographyField map, int triangleIndex) =>
        map.TectonicStrain[triangleIndex] >= 180 ||
        map.FractureConductance[triangleIndex] >= 560 ||
        map.VolcanicActivity[triangleIndex] > 0 ||
        (map.FeatureFlags[triangleIndex] & PhysicalGeographyFeatureCodes.MantlePlume) != 0;

    private static void ClassifyHeatSources(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationProfile profile)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            map.HeatSourceDensity[triangleIndex] = Math.Clamp(
                ((map.Geothermal[triangleIndex] * 2) +
                    map.FractureConductance[triangleIndex] +
                    map.TectonicStrain[triangleIndex] +
                    map.VolcanicActivity[triangleIndex]) / 4,
                0,
                1000);
            if (map.Geothermal[triangleIndex] < profile.GeothermalVentThreshold ||
                (map.TectonicStrain[triangleIndex] < 180 &&
                    map.FractureConductance[triangleIndex] < 560 &&
                    map.VolcanicActivity[triangleIndex] == 0 &&
                    (map.FeatureFlags[triangleIndex] & PhysicalGeographyFeatureCodes.MantlePlume) == 0))
            {
                continue;
            }

            map.FeatureFlags[triangleIndex] |= PhysicalGeographyFeatureCodes.GeothermalVent;
        }
    }

    private static int ScaleUnit(double value) =>
        (int)Math.Round(Math.Clamp(value, 0d, 1d) * 1000d, MidpointRounding.AwayFromZero);
}
