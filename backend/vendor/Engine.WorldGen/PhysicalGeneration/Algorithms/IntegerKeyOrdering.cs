namespace Engine.WorldGen;

internal static class IntegerKeyOrdering
{
    public static int[] DescendingThenIndex(ReadOnlySpan<long> keys)
    {
        if (keys.IsEmpty)
        {
            return [];
        }

        var source = Enumerable.Range(0, keys.Length).ToArray();
        var destination = new int[keys.Length];
        var counts = new int[1 << 16];
        for (var shift = 0; shift < 64; shift += 16)
        {
            Array.Clear(counts);
            foreach (var index in source)
            {
                counts[KeyChunk(keys[index], shift)]++;
            }

            var offset = 0;
            for (var bucket = 0; bucket < counts.Length; bucket++)
            {
                var count = counts[bucket];
                counts[bucket] = offset;
                offset += count;
            }

            foreach (var index in source)
            {
                var bucket = KeyChunk(keys[index], shift);
                destination[counts[bucket]++] = index;
            }

            (source, destination) = (destination, source);
        }

        Array.Reverse(source);
        return source;
    }

    public static int[] DescendingThenIndex(ReadOnlySpan<int> keys)
    {
        if (keys.IsEmpty)
        {
            return [];
        }

        var minimum = int.MaxValue;
        var maximum = int.MinValue;
        foreach (var key in keys)
        {
            minimum = Math.Min(minimum, key);
            maximum = Math.Max(maximum, key);
        }

        var heads = new int[checked(maximum - minimum + 1)];
        var next = new int[keys.Length];
        Array.Fill(heads, -1);
        Array.Fill(next, -1);
        for (var index = 0; index < keys.Length; index++)
        {
            var bucket = keys[index] - minimum;
            next[index] = heads[bucket];
            heads[bucket] = index;
        }

        var result = new int[keys.Length];
        var offset = 0;
        for (var bucket = heads.Length - 1; bucket >= 0; bucket--)
        {
            for (var index = heads[bucket]; index >= 0; index = next[index])
            {
                result[offset++] = index;
            }
        }

        return result;
    }

    private static int KeyChunk(long key, int shift) =>
        (ushort)(unchecked((ulong)(key ^ long.MinValue)) >> shift);
}
