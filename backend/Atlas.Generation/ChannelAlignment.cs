using Atlas.Domain;
using NetTopologySuite.Densify;
using NetTopologySuite.Geometries;
using Position = Atlas.Domain.Position;

namespace Atlas.Generation;

public static class ChannelAlignment
{
    // Start from the already connected embedding. A raster shortest path cannot resolve
    // two channels separated by less than one cell, and can change their intersection order.
    public static List<Position> Refine(RegionalGrid grid, LineString inherited, double head, double tail, List<Geometry> neighbors)
    {
        var spacing = Math.Min(grid.Dx, grid.Dy);
        var line = Densifier.Densify(inherited, spacing / 2);
        var points = line.Coordinates.Select(c => new Position(c.X, c.Y)).ToList();
        var shape = Spatial.Read(grid.Area.Footprint);
        var iterations = grid.Input.Request.Quality == "fine" ? 24 : grid.Input.Request.Quality == "draft" ? 8 : 16;
        for (var pass = 0; pass < iterations; pass++)
        {
            var step = spacing * .25 * Math.Pow(.5, pass / 4);
            for (var i = 1; i < points.Count - 1; i++)
            {
                var original = points[i]; var best = original;
                var score = Energy(i, original);
                foreach (var (dx, dy) in new[] { (-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1) })
                {
                    var candidate = new Position(original.X + dx * step, original.Y + dy * step);
                    var segment = Spatial.Read(Spatial.Line([points[i - 1], candidate, points[i + 1]]));
                    if (!shape.Contains(Spatial.Point(candidate)) || !shape.Covers(segment)) continue;
                    if (neighbors.Where(g => g.EnvelopeInternal.Intersects(segment.EnvelopeInternal)).Any(g =>
                        segment.Intersection(g).Coordinates.Any(c => c.Distance(line.Coordinates[0]) > 1e-5 && c.Distance(line.Coordinates[^1]) > 1e-5))) continue;
                    var cost = Energy(i, candidate);
                    if (cost >= score) continue;
                    points[i] = candidate;
                    var simple = Spatial.Read(Spatial.Line(points)).IsSimple;
                    points[i] = original;
                    if (simple) { best = candidate; score = cost; }
                }
                points[i] = best;
            }
        }
        return points;

        double Energy(int index, Position p)
        {
            var cell = grid.Index(p);
            var level = head + (tail - head) * index / (points.Count - 1);
            var cut = Math.Max(0, grid.Field.Sample("elevation", p) - level);
            if (grid.AvailableChange("elevation", cell, -cut) > -cut + 1e-6) return double.PositiveInfinity;
            var length = Spatial.Point(points[index - 1]).Distance(Spatial.Point(p)) + Spatial.Point(points[index + 1]).Distance(Spatial.Point(p));
            var curvature = Math.Pow(p.X - (points[index - 1].X + points[index + 1].X) / 2, 2) + Math.Pow(p.Y - (points[index - 1].Y + points[index + 1].Y) / 2, 2);
            return length + curvature / spacing + cut * cut * Math.Max(.05, grid.Field.Sample("rock", p) / 1000);
        }
    }
}
