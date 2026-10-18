namespace Engine.WorldGen;

/// <summary>
/// Integer identity on the global equilateral-triangle lattice. The two
/// orientations occupy the same rhombic vertex cell; neither storage nor
/// adjacency carries a coarser spatial parent.
/// </summary>
public readonly record struct MicrotriangleCoord(int U, int V, bool Inverted)
{
    public MicrotriangleCoord Neighbor(int edge)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(edge);
        ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(edge, 3);
        if (!Inverted)
        {
            return edge switch
            {
                0 => new(U, V, true),
                1 => new(U - 1, V, true),
                _ => new(U, V - 1, true),
            };
        }

        return edge switch
        {
            0 => new(U, V, false),
            1 => new(U + 1, V, false),
            _ => new(U, V + 1, false),
        };
    }
}
