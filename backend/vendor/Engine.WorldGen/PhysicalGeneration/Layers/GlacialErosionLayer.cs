namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class GlacialErosionLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "glacial-erosion",
        0,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.LandscapeHistory |
        PhysicalGeographyFacts.LandIce |
        PhysicalGeographyFacts.IceFlow |
        PhysicalGeographyFacts.Lakes,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.SedimentSupply |
        PhysicalGeographyFacts.GlacialEvolution,
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
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
        PhysicalGeographyFacts.GlacialMeltwater |
        PhysicalGeographyFacts.SeaIce |
        PhysicalGeographyFacts.Landforms |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (context.GlaciationStrength == 0 ||
                map.IceFlux[triangleIndex] < context.Profile.GlacierFluxThreshold ||
                map.IceThickness[triangleIndex] <= 0 ||
                map.GroundedIce[triangleIndex] == 0)
            {
                continue;
            }

            var power = 1d +
                ((map.IceFlux[triangleIndex] - context.Profile.GlacierFluxThreshold) /
                    (double)Math.Max(1, context.Profile.GlacierFluxThreshold)) +
                (map.IceThickness[triangleIndex] /
                    (double)Math.Max(1, context.Profile.GlacierThicknessThreshold));
            var resistance = map.CrustTypeCodes[triangleIndex] ==
                PhysicalCrustTypeCodes.Continental ? 4d : 3d;
            var cut = PhysicalElevation.FromUnits(Math.Clamp(
                power * 3d / resistance * context.GlaciationStrength / 1000d,
                1d / PhysicalElevation.SubunitsPerUnit,
                context.Profile.MaximumGlacialErosionPerPass));
            _ = LandscapeSurface.Erode(
                map,
                triangleIndex,
                cut);
            map.CumulativeGlacialErosion[triangleIndex] = checked(
                map.CumulativeGlacialErosion[triangleIndex] + cut);
            map.SedimentSupply[triangleIndex] = checked(map.SedimentSupply[triangleIndex] + cut);
            map.SedimentProducedTotal = checked(map.SedimentProducedTotal + cut);
        }

        GlacierSurface.RefreshGrounding(map, context.Profile);
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        LandscapeSurface.Validate(map);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.CumulativeGlacialErosion[triangleIndex] > 0 &&
                map.MaximumGroundedIceFlux[triangleIndex] < context.Profile.GlacierFluxThreshold)
            {
                throw new InvalidOperationException(
                    $"Glacial erosion at triangle {triangleIndex} in epoch {context.EpochIndex} " +
                    $"lacks qualifying grounded-ice history (erosion " +
                    $"{map.CumulativeGlacialErosion[triangleIndex]}, maximum grounded flux " +
                    $"{map.MaximumGroundedIceFlux[triangleIndex]}, threshold " +
                    $"{context.Profile.GlacierFluxThreshold}).");
            }
        }
    }
}
