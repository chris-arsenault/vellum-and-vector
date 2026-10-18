namespace Engine.Constants;

/// <summary>
/// Isostasy: surface height is what crustal thickness floats to, not a value
/// painted onto the map.
///
/// The continental mask cannot supply interior height. To keep coastlines
/// crisp a mask has to saturate at "definitely land", and once it saturates it
/// contributes no gradient across the interior it just defined - which is what
/// made every continent a flat mesa ringed by cliffs. Thickness has no such
/// ceiling: two collisions stack where one collided once, rifting thins, and
/// erosion removes. Height then follows from it for free.
/// </summary>
public static class PhysicalCrust
{
    /// <summary>
    /// Highest ground the world may hold, authored units. The old bound of
    /// 2,000 became the binding constraint on relief once collision could
    /// double crustal thickness: continents sat near 800 and the ceiling
    /// arrived at 1,850, a spread of about 2.3 against Earth's 11, so no
    /// amount of tectonics could separate a Himalaya from an Australia.
    /// </summary>
    public const int MaximumHeightUnits = 4000;

    /// <summary>Deepest the world may go, authored units.</summary>
    public const int MinimumHeightUnits = -4000;

    /// <summary>Thickness of unthickened continental crust, authored units.</summary>
    public const int ContinentalThicknessUnits = 4000;

    /// <summary>Thickness of oceanic crust, authored units.</summary>
    public const int OceanicThicknessUnits = 1000;

    /// <summary>
    /// Height of an undeformed continental foundation. Continental identity
    /// supplies modest freeboard; collision-thickened roots and constructed
    /// surface rock own the world's major positive relief.
    /// </summary>
    public const int ContinentalFoundationHeightUnits = 200;

    /// <summary>
    /// Continental height gained per unit of thickness above its foundation,
    /// per mille. Crust doubled by collision reaches 3,000 units of supported
    /// height before its narrower constructed summit load is applied.
    /// </summary>
    public const int ContinentalBuoyancyPerMille = 700;

    /// <summary>
    /// Height of young oceanic foundation before thermal subsidence. Deep
    /// water accumulates with crustal age across the basin rather than being a
    /// material cliff charged to every shoreline.
    /// </summary>
    public const int OceanicFoundationHeightUnits = -200;

    /// <summary>Oceanic response to departure from foundation thickness.</summary>
    public const int OceanicBuoyancyPerMille = 300;

    /// <summary>
    /// Half-range of per-province thickness variation, authored units.
    /// Continents are assembled from terranes that were never the same
    /// thickness. The continental mask cannot express that, because it
    /// saturates the moment it is confident the ground is land, so province
    /// identity carries the variation the mask cannot.
    /// </summary>
    public const int ProvinceThicknessRangeUnits = 520;

    /// <summary>
    /// Thickness bounds, chosen so derived height stays inside the elevation
    /// range the pipeline validates against. Crust cannot be arbitrarily thick
    /// any more than it can be arbitrarily thin; without this the relief terms
    /// can stack past the legal band.
    /// </summary>
    public const int MinimumThicknessUnits = 800;

    /// <inheritdoc cref="MinimumThicknessUnits"/>
    public const int MaximumThicknessUnits = 8000;

    /// <summary>Surface height in authored units for a given thickness.</summary>
    public static double HeightUnits(double thicknessUnits) => HeightUnits(thicknessUnits, false);

    /// <summary>Surface height at a discrete crust-composition endpoint.</summary>
    public static double HeightUnits(double thicknessUnits, bool oceanic) =>
        HeightUnits(thicknessUnits, oceanic ? 0d : 1d);

    /// <summary>
    /// Surface height for continuously varying crust composition. Each
    /// composition owns a matching foundation thickness and modest foundation
    /// height; deformation is measured from that local foundation. Evaluating
    /// mixed crust against both endpoint compensation columns introduced a
    /// convex sag and concentrated the material rise on the landward coast.
    /// </summary>
    public static double HeightUnits(double thicknessUnits, double continentalFraction)
    {
        var fraction = global::System.Math.Clamp(continentalFraction, 0d, 1d);
        var foundationThickness = OceanicThicknessUnits +
            ((ContinentalThicknessUnits - OceanicThicknessUnits) * fraction);
        var foundationHeight = OceanicFoundationHeightUnits +
            ((ContinentalFoundationHeightUnits - OceanicFoundationHeightUnits) * fraction);
        var deformation = ClampThicknessUnits(thicknessUnits) - foundationThickness;
        return foundationHeight + (deformation * BuoyancyPerMille(fraction) / 1000d);
    }

    /// <summary>
    /// Local thickness-to-height response for continuously varying crust
    /// composition, per mille.
    /// </summary>
    public static double BuoyancyPerMille(double continentalFraction) =>
        OceanicBuoyancyPerMille +
        ((ContinentalBuoyancyPerMille - OceanicBuoyancyPerMille) *
            global::System.Math.Clamp(continentalFraction, 0d, 1d));

    /// <summary>Thickness held inside the band height can legally express.</summary>
    public static double ClampThicknessUnits(double thicknessUnits) =>
        global::System.Math.Clamp(thicknessUnits, MinimumThicknessUnits, MaximumThicknessUnits);
}
