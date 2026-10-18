namespace Engine.WorldGen;

internal static class IntegerOrderStatistics
{
    public static int ValueAtDescendingRank(ReadOnlySpan<int> values, int rank)
    {
        if (values.IsEmpty)
        {
            throw new ArgumentException("Order statistics require at least one value.", nameof(values));
        }

        ArgumentOutOfRangeException.ThrowIfNegative(rank);
        ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(rank, values.Length);
        var minimum = int.MaxValue;
        var maximum = int.MinValue;
        foreach (var value in values)
        {
            minimum = Math.Min(minimum, value);
            maximum = Math.Max(maximum, value);
        }

        var counts = new int[checked(maximum - minimum + 1)];
        foreach (var value in values)
        {
            counts[value - minimum]++;
        }

        var seen = 0;
        for (var bucket = counts.Length - 1; bucket >= 0; bucket--)
        {
            seen += counts[bucket];
            if (seen > rank)
            {
                return bucket + minimum;
            }
        }

        throw new InvalidOperationException("Order-statistic histogram was incomplete.");
    }
}
