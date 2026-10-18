namespace Engine.WorldGen;

internal sealed class PhysicalGeographyGenerationContext
{
    public PhysicalGeographyGenerationContext(
        int seed,
        PhysicalGeographyGenerationProfile profile,
        PhysicalGeographyLayerContract contract,
        PhysicalGeographyEpochDefinition? epoch = null,
        int epochIndex = -1,
        int epochCount = 0)
    {
        Profile = profile;
        LayerName = contract.StableName;
        Epoch = epoch;
        EpochIndex = epochIndex;
        EpochCount = epochCount;
        unchecked
        {
            Seed = seed ^ contract.SeedSalt ^ EpochSeedSalt(epochIndex);
            EpochStableSeed = seed ^ contract.SeedSalt;
        }
    }

    public int Seed { get; }

    /// <summary>
    /// Layer-salted seed without the epoch salt, for persistent structure that
    /// must not move between epochs (cratons, belts, plume roots).
    /// </summary>
    public int EpochStableSeed { get; }

    public string LayerName { get; }

    public PhysicalGeographyGenerationProfile Profile { get; }

    public PhysicalGeographyEpochDefinition? Epoch { get; }

    public int EpochIndex { get; }

    public int EpochCount { get; }

    public bool IsEvolutionEpoch => Epoch is not null;

    public int TectonicStrength => Epoch?.TectonicStrength ?? 1000;

    public int HydrologyStrength => Epoch?.HydrologyStrength ?? 1000;

    public int GlaciationStrength => Epoch?.GlaciationStrength ?? 1000;

    public int CoastalStrength => Epoch?.CoastalStrength ?? 1000;

    public int TemperatureOffset => Epoch?.TemperatureOffset ?? 0;

    public int SeaLevelOffset => Epoch?.SeaLevelOffset ?? 0;

    private static int EpochSeedSalt(int epochIndex) => epochIndex < 0
        ? 0
        : unchecked((epochIndex + 1) * 0x45d9f3b);
}
