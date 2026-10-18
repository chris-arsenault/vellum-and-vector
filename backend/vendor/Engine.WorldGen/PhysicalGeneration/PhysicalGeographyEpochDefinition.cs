namespace Engine.WorldGen;

/// <summary>
/// Domain-neutral forcing applied during one geological evolution epoch.
/// Strengths use the common 0..1000 generation scalar; temperature and sea
/// level offsets use the physical field's integer units.
/// </summary>
public sealed record PhysicalGeographyEpochDefinition
{
    public required string StableName { get; init; }

    public int TectonicStrength { get; init; } = 1000;

    public int HydrologyStrength { get; init; } = 1000;

    public int GlaciationStrength { get; init; } = 1000;

    public int CoastalStrength { get; init; } = 1000;

    public int TemperatureOffset { get; init; }

    public int SeaLevelOffset { get; init; }

    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(StableName) ||
            !IsStrength(TectonicStrength) || !IsStrength(HydrologyStrength) ||
            !IsStrength(GlaciationStrength) || !IsStrength(CoastalStrength) ||
            TemperatureOffset is < -1000 or > 1000 || SeaLevelOffset is < -1000 or > 1000)
        {
            throw new InvalidOperationException("Physical geography epoch forcing is invalid.");
        }
    }

    private static bool IsStrength(int value) => value is >= 0 and <= 1000;
}
