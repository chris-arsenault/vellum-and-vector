using NetTopologySuite.Geometries;

namespace Atlas.Domain;

public static class FieldLimits
{
    public static void Validate(Area area, FieldData field, string channel)
    {
        foreach (var trait in area.Traits.Where(t => t.Kind == TraitKind.Hard &&
            (t.Field == channel || channel == "elevation" && t.Field == "relief")))
        {
            var scope = Spatial.Read(area.Footprint);
            foreach (var exception in area.Traits.Where(t => t.Kind == TraitKind.Exception && t.Field == trait.Field && t.Scope is not null))
                scope = scope.Difference(Spatial.Read(exception.Scope!));
            var values = Extrema(field, channel, scope).ToList();
            var valid = values.Count == 0 || (trait.Field == "relief"
                ? values.Max() - values.Min() <= trait.Maximum + 1e-6
                : values.Min() >= trait.Minimum - 1e-6 && values.Max() <= trait.Maximum + 1e-6);
            Guard.Require(valid, "trait_conflict", "The effective field surface exceeds an inherited hard constraint.");
        }
    }

    public static IEnumerable<double> Extrema(FieldData field, string channel, Geometry scope)
    {
        var remaining = scope;
        foreach (var mask in (field.Authored ?? []).AsEnumerable().Reverse().Where(m => m.Samples is not null && m.Channels.Contains(channel)))
        {
            var footprint = Spatial.Read(mask.Footprint);
            foreach (var value in PatchExtrema(mask.Samples!, channel, remaining.Intersection(footprint))) yield return value;
            remaining = remaining.Difference(footprint);
        }
        foreach (var value in PatchExtrema(new(field.Bounds, field.Width, field.Height, field.Values, field.WaterBodies), channel, remaining)) yield return value;
        // The fixed-edge interpolation is a convex combination of the grid and edge values.
        foreach (var sample in field.Boundary?.Samples ?? [])
            if (!remaining.IsEmpty && scope.Covers(Spatial.Point(sample.Point)) && sample.Values.TryGetValue(channel, out var value)) yield return value;
    }

    private static IEnumerable<double> PatchExtrema(SampledPatch patch, string channel, Geometry scope)
    {
        if (scope.IsEmpty) yield break;
        var dx = (patch.Bounds[2] - patch.Bounds[0]) / (patch.Width - 1);
        var dy = (patch.Bounds[3] - patch.Bounds[1]) / (patch.Height - 1);
        var envelope = scope.EnvelopeInternal;
        var x0 = Math.Clamp((int)Math.Floor((envelope.MinX - patch.Bounds[0]) / dx), 0, patch.Width - 2);
        var x1 = Math.Clamp((int)Math.Floor((envelope.MaxX - patch.Bounds[0]) / dx), 0, patch.Width - 2);
        var y0 = Math.Clamp((int)Math.Floor((envelope.MinY - patch.Bounds[1]) / dy), 0, patch.Height - 2);
        var y1 = Math.Clamp((int)Math.Floor((envelope.MaxY - patch.Bounds[1]) / dy), 0, patch.Height - 2);
        for (var y = y0; y <= y1; y++)
            for (var x = x0; x <= x1; x++)
            {
                var cell = Spatial.Read(Spatial.Rectangle(patch.Bounds[0] + dx * x, patch.Bounds[1] + dy * y, dx, dy));
                var clipped = cell.Intersection(scope);
                // A bilinear surface has no strict interior extrema; along each clipped edge it is quadratic.
                foreach (var part in Composition.Parts(clipped.Boundary).OfType<LineString>())
                    foreach (var (a, b) in part.Coordinates.Zip(part.Coordinates.Skip(1)))
                        foreach (var value in EdgeExtrema(patch, channel, a, b)) yield return value;
            }
    }

    private static IEnumerable<double> EdgeExtrema(SampledPatch patch, string channel, Coordinate a, Coordinate b)
    {
        double At(double t) => patch.Sample(channel, new(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t));
        var start = At(0);
        var end = At(1);
        var middle = At(.5);
        yield return start;
        yield return end;
        var quadratic = 2 * (start + end - 2 * middle);
        if (Math.Abs(quadratic) < 1e-12) yield break;
        var linear = end - start - quadratic;
        var t = -linear / (2 * quadratic);
        if (t > 0 && t < 1) yield return At(t);
    }
}
