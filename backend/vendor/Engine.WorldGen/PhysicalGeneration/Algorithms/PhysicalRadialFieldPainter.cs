namespace Engine.WorldGen;

/// <summary>
/// Applies the common squared radial falloff over the global microtriangle
/// lattice.
/// </summary>
internal static class PhysicalRadialFieldPainter
{
    public static void PaintMaximum(
        PhysicalGeographyGrid grid,
        Span<int> field,
        double centerX,
        double centerY,
        double radius,
        int strength)
    {
        ArgumentNullException.ThrowIfNull(grid);
        if (field.Length != grid.TriangleCount)
        {
            throw new ArgumentException("Radial field length does not match the physical grid.", nameof(field));
        }

        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(radius);
        var radiusSquared = radius * radius;
        for (var triangleIndex = 0; triangleIndex < grid.TriangleCount; triangleIndex++)
        {
            var dx = grid.TriangleX(triangleIndex) - centerX;
            var dy = grid.TriangleY(triangleIndex) - centerY;
            var distanceSquared = (dx * dx) + (dy * dy);
            if (distanceSquared > radiusSquared)
            {
                continue;
            }

            var amount = 1d - (Math.Sqrt(distanceSquared) / radius);
            field[triangleIndex] = Math.Max(
                field[triangleIndex],
                (int)Math.Round(strength * amount * amount, MidpointRounding.AwayFromZero));
        }
    }
}
