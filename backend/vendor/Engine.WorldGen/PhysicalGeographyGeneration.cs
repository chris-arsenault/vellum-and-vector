namespace Engine.WorldGen;

public static class PhysicalGeographyGenerator
{
    public static PhysicalGeographyField Generate(
        int triangleCount,
        int seed,
        PhysicalGeographyGenerationProfile profile) =>
        PhysicalGeographyPipeline.CreateDefault(profile).Generate(triangleCount, seed);
}
