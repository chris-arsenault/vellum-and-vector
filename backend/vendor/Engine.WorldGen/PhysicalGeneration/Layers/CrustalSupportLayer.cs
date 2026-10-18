namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Derives the local Airy support target from crustal thickness and explicit
/// surface loads. This stage does not move the surface; regional flexure owns
/// that reconciliation so rebound and subsidence are not one-cell impulses.
/// </summary>
internal sealed class CrustalSupportLayer(bool includeIceLoad) : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "crustal-support",
        0,
        PhysicalGeographyFacts.TectonicProvinces |
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.LandscapeHistory,
        PhysicalGeographyFacts.CrustalSupport);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var thickness = PhysicalElevation.ToUnits(map.CrustThickness[triangleIndex]);
            var continentalFraction = map.CrustContinentalFraction[triangleIndex] / 1000d;
            var airy = PhysicalElevation.FromUnits(
                PhysicalCrust.HeightUnits(thickness, continentalFraction));
            var oceanicSubsidence = PhysicalElevation.FromUnits(
                (1d - continentalFraction) *
                (map.CrustAge[triangleIndex] / 1000d) *
                context.Profile.OceanicSubsidenceDepth);
            var load = PhysicalElevation.Multiply(
                map.SurfaceRockLoad[triangleIndex],
                context.Profile.BedrockLoadResponsePerMille,
                1000);
            load = checked(load + PhysicalElevation.Multiply(
                map.SedimentThickness[triangleIndex],
                context.Profile.SedimentLoadResponsePerMille,
                1000));
            if (includeIceLoad && map.GroundedIce[triangleIndex] != 0)
            {
                load = checked(load + PhysicalElevation.Multiply(
                    PhysicalElevation.FromUnits(map.IceThickness[triangleIndex]),
                    context.Profile.IceLoadResponsePerMille,
                    1000));
            }

            map.CrustSupportTarget[triangleIndex] = Math.Clamp(
                checked(airy - oceanicSubsidence - load),
                PhysicalElevation.FromUnits(PhysicalCrust.MinimumHeightUnits),
                PhysicalElevation.FromUnits(PhysicalCrust.MaximumHeightUnits));
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        var minimum = PhysicalElevation.FromUnits(PhysicalCrust.MinimumHeightUnits);
        var maximum = PhysicalElevation.FromUnits(PhysicalCrust.MaximumHeightUnits);
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            if (map.CrustSupportTarget[triangleIndex] < minimum ||
                map.CrustSupportTarget[triangleIndex] > maximum)
            {
                throw new InvalidOperationException("Crustal support target is outside its physical range.");
            }
        }
    }
}
