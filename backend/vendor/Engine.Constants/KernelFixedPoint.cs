namespace Engine.Constants;

/// <summary>
/// Shared numeric representations used at the authored-domain, kernel, event,
/// persistence, and presentation boundaries. Authored values remain ordinary
/// floating-point numbers; only compiled/runtime state uses these units.
/// </summary>
public static class KernelFixedPoint
{
    public const int CultureMassScale = 1_000;
    public const int CultureMassMaximumUnits = 1_000_000 * CultureMassScale;

    public const int RelationshipStrengthScale = 1_000_000;
    public const int RelationshipStrengthMaximumUnits = RelationshipStrengthScale;

    public const int AttributeScale = 100_000;
    public const int AttributeMinimumUnits = -10_000 * AttributeScale;
    public const int AttributeMaximumUnits = 10_000 * AttributeScale;

    public const int RoadQualityScale = 1_000;
    public const int RoadQualityMaximumUnits = 100 * RoadQualityScale;

    public const int ModifierScale = 100_000;
    public const int ModifierMinimumUnits = -10_000 * ModifierScale;
    public const int ModifierMaximumUnits = 10_000 * ModifierScale;

    public const int RatioScale = 1_000_000;
    public const int RatioMinimumUnits = -100 * RatioScale;
    public const int RatioMaximumUnits = 100 * RatioScale;

    public static int CultureMassUnits(float value) =>
        Quantize(value, CultureMassScale, -CultureMassMaximumUnits, CultureMassMaximumUnits);

    public static int CultureMassUnits(FixedScalar value) =>
        ConvertUnits(
            value,
            CultureMassScale,
            -CultureMassMaximumUnits,
            CultureMassMaximumUnits);

    public static float CultureMassValue(int units) => (float)units / CultureMassScale;

    public static float CultureMassValue(long units) => (float)units / CultureMassScale;

    public static FixedScalar CultureMassScalar(int units) =>
        FixedScalar.FromRatio(units, CultureMassScale);

    public static FixedScalar CultureMassScalar(long units) =>
        FixedScalar.FromRatio(units, CultureMassScale);

    public static int RelationshipStrengthUnits(float value) =>
        Quantize(value, RelationshipStrengthScale, 0, RelationshipStrengthMaximumUnits);

    public static int RelationshipStrengthUnits(FixedScalar value) =>
        ConvertUnits(value, RelationshipStrengthScale, 0, RelationshipStrengthMaximumUnits);

    public static int RelationshipStrengthDeltaUnits(float value) =>
        Quantize(
            value,
            RelationshipStrengthScale,
            -RelationshipStrengthMaximumUnits,
            RelationshipStrengthMaximumUnits);

    public static int RelationshipStrengthDeltaUnits(FixedScalar value) =>
        ConvertUnits(
            value,
            RelationshipStrengthScale,
            -RelationshipStrengthMaximumUnits,
            RelationshipStrengthMaximumUnits);

    public static float RelationshipStrengthValue(int units) =>
        (float)units / RelationshipStrengthScale;

    public static FixedScalar RelationshipStrengthScalar(int units) =>
        FixedScalar.FromRatio(units, RelationshipStrengthScale);

    public static int AttributeUnits(float value) =>
        Quantize(value, AttributeScale, AttributeMinimumUnits, AttributeMaximumUnits);

    public static int AttributeUnits(FixedScalar value) =>
        ConvertUnits(value, AttributeScale, AttributeMinimumUnits, AttributeMaximumUnits);

    public static float AttributeValue(int units) => (float)units / AttributeScale;

    public static FixedScalar AttributeScalar(int units) =>
        FixedScalar.FromRatio(units, AttributeScale);

    public static int RoadQualityUnits(float value) =>
        Quantize(value, RoadQualityScale, 0, RoadQualityMaximumUnits);

    public static int RoadQualityUnits(FixedScalar value) =>
        ConvertUnits(value, RoadQualityScale, 0, RoadQualityMaximumUnits);

    public static int RoadWorkUnits(float value) =>
        Quantize(value, RoadQualityScale, -RoadQualityMaximumUnits, RoadQualityMaximumUnits);

    public static int RoadWorkUnits(FixedScalar value) =>
        ConvertUnits(
            value,
            RoadQualityScale,
            -RoadQualityMaximumUnits,
            RoadQualityMaximumUnits);

    public static float RoadQualityValue(int units) => (float)units / RoadQualityScale;

    public static FixedScalar RoadQualityScalar(int units) =>
        FixedScalar.FromRatio(units, RoadQualityScale);

    public static int ModifierUnits(float value) =>
        Quantize(value, ModifierScale, ModifierMinimumUnits, ModifierMaximumUnits);

    public static int ModifierUnits(FixedScalar value) =>
        ConvertUnits(value, ModifierScale, ModifierMinimumUnits, ModifierMaximumUnits);

    public static float ModifierValue(int units) => (float)units / ModifierScale;

    public static FixedScalar ModifierScalar(int units) =>
        FixedScalar.FromRatio(units, ModifierScale);

    public static int RatioUnits(float value) =>
        Quantize(value, RatioScale, RatioMinimumUnits, RatioMaximumUnits);

    public static int RatioUnits(FixedScalar value) =>
        ConvertUnits(value, RatioScale, RatioMinimumUnits, RatioMaximumUnits);

    public static float RatioValue(int units) => (float)units / RatioScale;

    public static FixedScalar RatioScalar(int units) =>
        FixedScalar.FromRatio(units, RatioScale);

    public static int SaturatingAdd(int value, int delta, int minimum, int maximum)
    {
        var sum = (long)value + delta;
        return ClampToInt(sum, minimum, maximum);
    }

    public static int ClampToInt(long value, int minimum, int maximum)
    {
        if (value < minimum)
        {
            return minimum;
        }

        return value > maximum ? maximum : (int)value;
    }

    public static int MultiplyByRatio(
        int valueUnits,
        int ratioUnits,
        int minimum,
        int maximum)
    {
        var product = (long)valueUnits * ratioUnits;
        var rounded = DivideAwayFromZero(product, RatioScale);
        return ClampToInt(rounded, minimum, maximum);
    }

    private static int Quantize(float value, int scale, int minimum, int maximum)
    {
        if (!float.IsFinite(value))
        {
            throw new global::System.ArgumentOutOfRangeException(nameof(value));
        }

        var scaled = global::System.Math.Round(
            (double)value * scale,
            global::System.MidpointRounding.AwayFromZero);
        if (scaled < minimum || scaled > maximum)
        {
            throw new global::System.ArgumentOutOfRangeException(nameof(value));
        }

        return (int)scaled;
    }

    private static int ConvertUnits(
        FixedScalar value,
        int scale,
        int minimum,
        int maximum)
    {
        var units = DivideAwayFromZero(
            (global::System.Int128)value.Units * scale,
            FixedScalar.Scale);
        if (units < minimum || units > maximum)
        {
            throw new global::System.ArgumentOutOfRangeException(nameof(value));
        }

        return (int)units;
    }

    private static long DivideAwayFromZero(long numerator, int denominator)
    {
        var quotient = numerator / denominator;
        var remainder = numerator % denominator;
        if (remainder == 0)
        {
            return quotient;
        }

        var absoluteRemainder = global::System.Math.Abs(remainder);
        if (absoluteRemainder * 2 < denominator)
        {
            return quotient;
        }

        return quotient + global::System.Math.Sign(numerator);
    }

    private static global::System.Int128 DivideAwayFromZero(
        global::System.Int128 numerator,
        global::System.Int128 denominator)
    {
        var quotient = numerator / denominator;
        var remainder = numerator % denominator;
        if (remainder == 0)
        {
            return quotient;
        }

        var absoluteRemainder = global::System.Int128.Abs(remainder);
        if (absoluteRemainder * 2 < denominator)
        {
            return quotient;
        }

        return quotient + global::System.Int128.Sign(numerator);
    }
}
