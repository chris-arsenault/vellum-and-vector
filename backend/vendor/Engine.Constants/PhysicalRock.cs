namespace Engine.Constants;

/// <summary>
/// Rock durability against erosion, per mille.
/// </summary>
public static class PhysicalRock
{
    /// <summary>Ordinary rock. Resistance is expressed relative to this.</summary>
    public const int BaselineResistance = 1000;

    /// <summary>Softest rock erosion will see, so nothing erodes instantly.</summary>
    public const int MinimumResistance = 250;

    /// <summary>Hardest rock erosion will see, so nothing is permanent.</summary>
    public const int MaximumResistance = 4000;

    /// <summary>
    /// Resistance an impact site gains at its centre. Shocked rock is
    /// genuinely among the most durable on a planet, which is why old craters
    /// survive as rings long after everything around them has worn flat.
    /// </summary>
    public const int ImpactShockResistance = 2600;

    /// <summary>
    /// Resistance of loose cover: ejecta aprons, alluvium, anything not yet
    /// rock. Debris is the least durable material a planet makes, so a blanket
    /// laid over hard ground washes off it rather than inheriting its
    /// durability and burying it forever.
    /// </summary>
    public const int SedimentResistance = 300;

    /// <summary>
    /// Sediment depth, in authored units, at which cover fully governs how
    /// fast the ground wears. Below it, rock beneath still shows through.
    /// </summary>
    public const int SedimentCoverUnits = 25;

    public static int Clamp(int resistance) =>
        global::System.Math.Clamp(resistance, MinimumResistance, MaximumResistance);
}
