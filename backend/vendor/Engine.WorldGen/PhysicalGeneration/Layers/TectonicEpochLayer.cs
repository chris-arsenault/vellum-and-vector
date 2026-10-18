namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Selects the active portions and relative mode of the persistent province
/// boundaries for one evolution epoch. Province identity remains stable while
/// collisions, transforms, and rifts can strengthen, weaken, or change mode.
/// </summary>
internal sealed class TectonicEpochLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "tectonic-epoch-activity",
        0x1d71c3,
        PhysicalGeographyFacts.TectonicProvinces,
        PhysicalGeographyFacts.TectonicProvinces,
        PhysicalGeographyFacts.ContinentalSutures |
        PhysicalGeographyFacts.OrogenicConstruction |
        PhysicalGeographyFacts.ContinentalDomains |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.VolcanicConstruction |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.Fractures |
        PhysicalGeographyFacts.Geothermal |
        PhysicalGeographyFacts.OceanCurrents |
        PhysicalGeographyFacts.Warmth |
        PhysicalGeographyFacts.Temperature |
        PhysicalGeographyFacts.AtmosphericFlow |
        PhysicalGeographyFacts.Moisture |
        PhysicalGeographyFacts.Precipitation |
        PhysicalGeographyFacts.Runoff |
        PhysicalGeographyFacts.DrainageConditioning |
        PhysicalGeographyFacts.Lakes |
        PhysicalGeographyFacts.FlowRouting |
        PhysicalGeographyFacts.Rivers |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.IceFlow |
        PhysicalGeographyFacts.SeaIce |
        PhysicalGeographyFacts.GlacialMeltwater |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.RiverGeometry |
        PhysicalGeographyFacts.Floodplains |
        PhysicalGeographyFacts.Deltas |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        if (!context.IsEvolutionEpoch)
        {
            throw new InvalidOperationException("Tectonic epoch activity requires an evolution epoch.");
        }

        var persistence = context.Profile.TectonicBoundaryPersistence / 1000d;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var initialCode = map.InitialTectonicBoundaryCodes[triangleIndex];
            var initialStrain = map.InitialTectonicStrain[triangleIndex];
            if (initialCode == PhysicalTectonicBoundaryCodes.None || initialStrain == 0)
            {
                map.TectonicBoundaryCodes[triangleIndex] = PhysicalTectonicBoundaryCodes.None;
                map.TectonicStrain[triangleIndex] = 0;
                continue;
            }

            // Plate motion already determines whether this pair converges,
            // diverges, or shears. An epoch may strengthen or weaken the
            // contact, but cannot independently repaint adjacent pieces of
            // one plate pair into different modes without fragmenting a
            // single mountain system into numerical stripes.
            var pairActivity = PhysicalNoise.HashUnit(
                context.Seed ^ 0x58d7,
                map.TectonicBoundaryPairIds[triangleIndex],
                initialCode);
            var activity = persistence + ((1d - persistence) * pairActivity);
            map.TectonicBoundaryCodes[triangleIndex] = initialCode;
            map.TectonicStrain[triangleIndex] = (int)Math.Round(
                Math.Clamp(initialStrain * activity, 0d, 1000d),
                MidpointRounding.AwayFromZero);
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        if (!context.IsEvolutionEpoch)
        {
            throw new InvalidOperationException("Tectonic epoch validation requires an evolution epoch.");
        }

        var active = false;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (PrimitiveIsInvalid(map, triangleIndex))
            {
                throw new InvalidOperationException("Epoch tectonic activity is inconsistent with its provinces.");
            }

            active |= map.TectonicBoundaryCodes[triangleIndex] !=
                PhysicalTectonicBoundaryCodes.None && map.TectonicStrain[triangleIndex] > 0;
        }

        if (context.TectonicStrength > 0 && !active)
        {
            throw new InvalidOperationException("Evolution epoch produced no active tectonic boundary.");
        }
    }

    private static bool PrimitiveIsInvalid(PhysicalGeographyField map, int triangleIndex)
    {
        var code = map.TectonicBoundaryCodes[triangleIndex];
        var strain = map.TectonicStrain[triangleIndex];
        return code is < PhysicalTectonicBoundaryCodes.Min or > PhysicalTectonicBoundaryCodes.Max ||
            strain is < 0 or > 1000 ||
            map.InitialTectonicBoundaryCodes[triangleIndex] == PhysicalTectonicBoundaryCodes.None &&
            (code != PhysicalTectonicBoundaryCodes.None || strain != 0);
    }

}
