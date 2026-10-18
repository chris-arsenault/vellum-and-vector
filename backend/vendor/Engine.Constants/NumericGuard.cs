namespace Engine.Constants;

#pragma warning disable CA1512

public static class NumericGuard
{
    public static void ThrowIfNegative(int value)
    {
        if (value < 0)
        {
            throw new global::System.ArgumentOutOfRangeException(nameof(value));
        }
    }

    public static void ThrowIfNegative(long value)
    {
        if (value < 0L)
        {
            throw new global::System.ArgumentOutOfRangeException(nameof(value));
        }
    }

    public static void ThrowIfNegative(FixedScalar value)
    {
        if (value < FixedScalar.Zero)
        {
            throw new global::System.ArgumentOutOfRangeException(nameof(value));
        }
    }

    public static void ThrowIfNegativeOrZero(int value)
    {
        if (value <= 0)
        {
            throw new global::System.ArgumentOutOfRangeException(nameof(value));
        }
    }

    public static void ThrowIfNegativeOrZero(FixedScalar value)
    {
        if (value <= FixedScalar.Zero)
        {
            throw new global::System.ArgumentOutOfRangeException(nameof(value));
        }
    }

    public static void ThrowIfLessThan(int value, int other)
    {
        if (value < other)
        {
            throw new global::System.ArgumentOutOfRangeException(nameof(value));
        }
    }

    public static void ThrowIfLessThan(FixedScalar value, FixedScalar other)
    {
        if (value < other)
        {
            throw new global::System.ArgumentOutOfRangeException(nameof(value));
        }
    }

    public static void ThrowIfGreaterThan(int value, int other)
    {
        if (value > other)
        {
            throw new global::System.ArgumentOutOfRangeException(nameof(value));
        }
    }

    public static void ThrowIfGreaterThanOrEqual(int value, int other)
    {
        if (value >= other)
        {
            throw new global::System.ArgumentOutOfRangeException(nameof(value));
        }
    }
}

#pragma warning restore CA1512
