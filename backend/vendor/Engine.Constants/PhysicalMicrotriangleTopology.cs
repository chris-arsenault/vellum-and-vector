namespace Engine.Constants;

/// <summary>
/// Canonical topology for the 24-triangle subdivision of a pointy-top hex.
/// Triangle and edge indexes are primitive contracts shared by worldgen and
/// the simulation kernel.
/// </summary>
public static class PhysicalMicrotriangleTopology
{
    // Sector s's outer hex edge faces angle 60°·s (with the +y hex row below
    // in axial space), so its cross-hex neighbor is the hex in that facing
    // direction. The previous table was the y-mirror of this for the four
    // diagonal sectors, which linked geometrically distant triangles: flow
    // "teleported" one hex row at those edges, rivers rendered as disjoint
    // segments, and every graph process carried hex-boundary artifacts.
    private static readonly int[] NeighborDQ = [1, 0, -1, -1, 0, 1];
    private static readonly int[] NeighborDR = [0, 1, 1, 0, -1, -1];

    public static int TriangleIndex(int sector, int localTriangle)
    {
        global::System.ArgumentOutOfRangeException.ThrowIfNegative(sector);
        global::System.ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(
            sector,
            PhysicalGeographyCodes.HexSectorCount);
        global::System.ArgumentOutOfRangeException.ThrowIfNegative(localTriangle);
        global::System.ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(
            localTriangle,
            PhysicalGeographyCodes.MicrotrianglesPerSector);

        return (sector * PhysicalGeographyCodes.MicrotrianglesPerSector) + localTriangle;
    }

    public static void ResolveNeighbor(
        int q,
        int r,
        int triangleIndex,
        int edge,
        out int neighborQ,
        out int neighborR,
        out int neighborTriangleIndex)
    {
        global::System.ArgumentOutOfRangeException.ThrowIfNegative(triangleIndex);
        global::System.ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(
            triangleIndex,
            PhysicalGeographyCodes.MicrotrianglesPerHex);
        global::System.ArgumentOutOfRangeException.ThrowIfNegative(edge);
        global::System.ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(edge, 3);

        var sector = triangleIndex / PhysicalGeographyCodes.MicrotrianglesPerSector;
        var local = triangleIndex % PhysicalGeographyCodes.MicrotrianglesPerSector;
        neighborQ = q;
        neighborR = r;
        if (local == 3)
        {
            neighborTriangleIndex = TriangleIndex(sector, edge);
            return;
        }

        if (edge == 0)
        {
            neighborTriangleIndex = TriangleIndex(sector, 3);
            return;
        }

        if (local == 0)
        {
            var adjacentSector = edge == 1 ? (sector + 5) % 6 : (sector + 1) % 6;
            neighborTriangleIndex = TriangleIndex(adjacentSector, 0);
            return;
        }

        ResolveOuterNeighbor(
            sector,
            local,
            edge,
            ref neighborQ,
            ref neighborR,
            out neighborTriangleIndex);
    }

    private static void ResolveOuterNeighbor(
        int sector,
        int local,
        int edge,
        ref int neighborQ,
        ref int neighborR,
        out int neighborTriangleIndex)
    {
        var firstHalf = local == 1;
        if (edge == 1)
        {
            var adjacentSector = firstHalf ? (sector + 5) % 6 : (sector + 1) % 6;
            neighborTriangleIndex = TriangleIndex(adjacentSector, firstHalf ? 2 : 1);
            return;
        }

        neighborQ += NeighborDQ[sector];
        neighborR += NeighborDR[sector];
        neighborTriangleIndex = TriangleIndex((sector + 3) % 6, firstHalf ? 2 : 1);
    }
}
