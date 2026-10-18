namespace Engine.WorldGen;

using Engine.Constants;

/// <summary>
/// Materializes the ocean-distance field once for every ocean topology so all
/// climate consumers share the same derived geography.
/// </summary>
internal sealed class OceanDistanceLayer : IPhysicalGeographyLayer
{
    public PhysicalGeographyLayerContract Contract { get; } = new(
        "ocean-distance",
        0,
        PhysicalGeographyFacts.Ocean,
        PhysicalGeographyFacts.OceanDistance,
        PhysicalGeographyFacts.None);

    public void Apply(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        PhysicalDistanceFields.FillFromOcean(map, map.OceanDistance);
    }

    public void Validate(PhysicalGeographyField map, PhysicalGeographyGenerationContext context)
    {
        _ = context;
        for (var triangleIndex = 0; triangleIndex < map.Grid.TriangleCount; triangleIndex++)
        {
            var expectedOcean = map.WaterKindCodes[triangleIndex] == PhysicalWaterKindCodes.Ocean;
            if ((expectedOcean && map.OceanDistance[triangleIndex] != 0) ||
                (!expectedOcean && map.OceanDistance[triangleIndex] <= 0))
            {
                throw new InvalidOperationException("Ocean distance contradicts connected water geography.");
            }
        }
    }
}
