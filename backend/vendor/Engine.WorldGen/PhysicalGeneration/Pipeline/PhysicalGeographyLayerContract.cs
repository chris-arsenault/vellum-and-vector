namespace Engine.WorldGen;

internal readonly record struct PhysicalGeographyLayerContract(
    string StableName,
    int SeedSalt,
    PhysicalGeographyFacts Requires,
    PhysicalGeographyFacts Produces,
    PhysicalGeographyFacts Invalidates = PhysicalGeographyFacts.None);

internal interface IPhysicalGeographyLayer :
    IMapGenerationLayer<PhysicalGeographyField, PhysicalGeographyGenerationContext>
{
    PhysicalGeographyLayerContract Contract { get; }
}
