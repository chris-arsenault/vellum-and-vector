namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class LandscapeInitializationLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "landscape-initialization",
        0,
        PhysicalGeographyFacts.TectonicProvinces | PhysicalGeographyFacts.Elevation,
        PhysicalGeographyFacts.LandscapeHistory);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        map.RockResistance.Fill(PhysicalRock.BaselineResistance);
        _ = context;
        map.SedimentThickness.Clear();
        map.SedimentSupply.Clear();
        map.CumulativeFluvialErosion.Clear();
        map.CumulativeGlacialErosion.Clear();
        map.CumulativeGlacialDeposition.Clear();
        map.CumulativeCoastalErosion.Clear();
        map.CumulativeDeposition.Clear();
        map.MaximumIceThickness.Clear();
        map.MaximumIceFlux.Clear();
        map.WaveExposureHistory.Clear();
        map.GeothermalHistory.Clear();
        map.VolcanicActivity.Clear();
        map.VolcanicConstructionHistory.Clear();
        map.VolcanicLastActiveEpoch.Fill(-1);
        map.ExternalHeatForcing.Clear();
        map.ExternalCoastalForcing.Clear();
        map.ExternalCoastalForcingHistory.Clear();
        map.CompletedEpochCount = 0;
        map.SedimentProducedTotal = 0;
        map.SedimentDepositedTotal = 0;
        map.SedimentExportedTotal = 0;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            map.BedrockElevation[triangleIndex] = map.Elevation[triangleIndex];
            map.CrustSupportElevation[triangleIndex] = map.Elevation[triangleIndex];
            map.TectonicActivityHistory[triangleIndex] = map.TectonicStrain[triangleIndex];
        }

        // Tectonic uplift established the initial flotation datum. Subsequent
        // thickness changes must move the bedrock relative to this datum on
        // the first flexure pass instead of being mistaken for initialization.
        map.CrustSupportInitialized = true;
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        LandscapeSurface.Validate(map);
    }
}
