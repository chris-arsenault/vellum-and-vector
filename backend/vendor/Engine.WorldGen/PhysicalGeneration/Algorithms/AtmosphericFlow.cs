namespace Engine.WorldGen;

internal static class AtmosphericFlow
{
    /// <summary>
    /// Banded prevailing circulation rather than one global wind vector.
    ///
    /// A single hashed direction for the whole planet made every rain shadow
    /// and moisture gradient tilt the same way, which showed up as a strong
    /// column-versus-row asymmetry in the field statistics and made the
    /// climate overlays read as recolourings of one another. Latitude bands
    /// alternate direction the way real circulation cells do, so a range
    /// blocks moisture on one side in one band and the other side a band away,
    /// and rain shadows stop being globally parallel.
    /// </summary>
    public static void WindDirection(
        PhysicalGeographyField map,
        PhysicalGeographyGenerationContext context,
        int triangleIndex,
        out double windX,
        out double windY)
    {
        var x = map.Grid.TriangleX(triangleIndex);
        var y = map.Grid.TriangleY(triangleIndex);
        var profile = context.Profile;

        // Bands run across the disk; the alternation is what breaks the global
        // tilt. The seeded phase keeps worlds from sharing a band layout.
        var span = Math.Max(1d, map.Grid.ContentRadius * 1.5d / Math.Max(1, profile.CirculationBands));
        var phase = PhysicalNoise.HashUnit(context.Seed, 0x2a1, 0x7c9);
        var bandPosition = (y / span) + phase;
        var band = Math.Floor(bandPosition);

        // Easterly and westerly belts alternate, and each belt turns poleward
        // or equatorward across its own width, giving the curved streamlines of
        // a real cell instead of a straight sheet.
        var alongBand = ((int)band & 1) == 0 ? 1d : -1d;
        var acrossBand = Math.Cos((bandPosition - band) * Math.PI * 2d) *
            (profile.CirculationCellTurn / 1000d);

        // Terrain-scale wander so bands are not visible as straight seams.
        var wander = PhysicalNoise.FractalNoise(
            x,
            y,
            context.Seed ^ 0x713b,
            Math.Max(12d, map.Grid.ContentRadius * 0.28d),
            3) * (profile.CirculationWander / 1000d);

        var angle = Math.Atan2(acrossBand, alongBand) + wander;
        windX = Math.Cos(angle);
        windY = Math.Sin(angle);
    }

    public static int MostAlignedNeighbor(
        PhysicalGeographyField map,
        int triangleIndex,
        double directionX,
        double directionY)
    {
        var best = -1;
        var bestAlignment = double.MinValue;
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = map.Grid.NeighborTriangleIndex(triangleIndex, edge);
            if (neighbor < 0)
            {
                continue;
            }

            var alignment = (map.Grid.TriangleEdgeUnitX(triangleIndex, edge) * directionX) +
                (map.Grid.TriangleEdgeUnitY(triangleIndex, edge) * directionY);
            if (alignment > bestAlignment)
            {
                best = neighbor;
                bestAlignment = alignment;
            }
        }

        return best;
    }
}
