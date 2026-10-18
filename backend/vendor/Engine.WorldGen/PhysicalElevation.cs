namespace Engine.WorldGen;

/// <summary>
/// Deterministic generation-time elevation units. Authored profile values use
/// whole world units; physical evolution retains binary fixed-point subunits.
/// </summary>
public static class PhysicalElevation
{
    public const long SubunitsPerUnit = 1024L;

    public static long FromUnits(int units) => checked(units * SubunitsPerUnit);

    public static long FromUnits(double units) => checked((long)Math.Round(
        units * SubunitsPerUnit,
        MidpointRounding.AwayFromZero));

    public static long FromScaled(double normalizedValue, int authoredScale) =>
        FromUnits(Math.Clamp(normalizedValue, -2d, 2d) * authoredScale);

    public static int ToUnits(long subunits) => checked((int)Math.Round(
        subunits / (double)SubunitsPerUnit,
        MidpointRounding.AwayFromZero));

    public static int ToDiagnosticValue(long subunits) => checked((int)subunits);

    public static long Multiply(long value, int numerator, int denominator)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(numerator);
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(denominator, 0);
        return checked(value * numerator / denominator);
    }

}
