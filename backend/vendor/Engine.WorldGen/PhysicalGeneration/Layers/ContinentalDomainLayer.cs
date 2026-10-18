namespace Engine.WorldGen;

using Engine.Constants;

internal sealed class ContinentalDomainLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "continental-domains",
        0x12e5a91,
        PhysicalGeographyFacts.TectonicProvinces,
        PhysicalGeographyFacts.ContinentalDomains,
        PhysicalGeographyFacts.Elevation |
        PhysicalGeographyFacts.Ocean |
        PhysicalGeographyFacts.Bathymetry |
        PhysicalGeographyFacts.Landmasses |
        PhysicalGeographyFacts.Fractures |
        PhysicalGeographyFacts.Geothermal |
        PhysicalGeographyFacts.Validated);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var x = map.Grid.TriangleX(triangleIndex);
            var y = map.Grid.TriangleY(triangleIndex);
            var potential = map.CrustBasePotential[triangleIndex] / 1000d;
            var roughness = PhysicalNoise.FractalNoise(
                x,
                y,
                context.Seed ^ 0x41c7,
                Math.Max(8d, context.Profile.ContinentalWarpScale * 0.44d),
                4);
            var margin = 1d - Math.Clamp(Math.Abs(potential - 0.5d) * 2d, 0d, 1d);
            roughness *= 0.025d + (margin * margin * 0.14d);
            var strain = map.TectonicStrain[triangleIndex] / 1000d;
            var boundaryAdjustment = map.TectonicBoundaryCodes[triangleIndex] switch
            {
                PhysicalTectonicBoundaryCodes.Convergent => strain * 0.07d,
                PhysicalTectonicBoundaryCodes.Divergent => strain * -0.12d,
                _ => 0d,
            };
            map.ContinentalPotential[triangleIndex] = ScaleUnit(
                SmoothStep(Math.Clamp(potential + roughness + boundaryAdjustment, 0d, 1d)));
        }
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        var minimum = int.MaxValue;
        var maximum = int.MinValue;
        foreach (var value in map.ContinentalPotential)
        {
            minimum = Math.Min(minimum, value);
            maximum = Math.Max(maximum, value);
        }

        if (minimum < 0 || maximum > 1000 || maximum - minimum < 600)
        {
            throw new InvalidOperationException("Continental domains do not span coherent land and ocean potentials.");
        }
    }

    private static double SmoothStep(double value) => value * value * (3d - (2d * value));

    private static int ScaleUnit(double value) =>
        (int)Math.Round(Math.Clamp(value, 0d, 1d) * 1000d, MidpointRounding.AwayFromZero);
}
