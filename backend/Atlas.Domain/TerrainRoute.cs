namespace Atlas.Domain;

public static class TerrainRoute
{
    public static List<Position> Find(FieldData field, Area area, Position start, Position end,
        Func<Position, Position, double>? movement = null)
    {
        var shape = Spatial.Read(area.Footprint);
        var costs = Enumerable.Repeat(double.PositiveInfinity, field.Width * field.Height).ToArray();
        var parents = Enumerable.Repeat(-1, costs.Length).ToArray();
        var origin = Index(start);
        var target = Index(end);
        var queue = new PriorityQueue<int, (double, int)>();
        costs[origin] = 0;
        queue.Enqueue(origin, (0, origin));
        while (queue.TryDequeue(out var index, out var priority))
        {
            if (priority.Item1 > costs[index]) continue;
            if (index == target) return Reconstruct();
            var x = index % field.Width;
            var y = index / field.Width;
            foreach (var (dx, dy) in new[] { (-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1) })
            {
                var nx = x + dx; var ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= field.Width || ny >= field.Height) continue;
                var p = ny * field.Width + nx == target ? end : field.PositionAt(nx, ny);
                var from = index == origin ? start : field.PositionAt(x, y);
                if (ny * field.Width + nx != target && ny * field.Width + nx != origin && !shape.Contains(Spatial.Point(p))) continue;
                if (!shape.Covers(Spatial.Point(p)) || movement is null && field.Sample("elevation", p) < 0 ||
                    !shape.Covers(Spatial.Read(Spatial.Line([from, p])))) continue;
                var distance = Spatial.Point(from).Distance(Spatial.Point(p));
                var grade = Math.Abs(field.Sample("elevation", p) - field.Sample("elevation", from)) / Math.Max(0.01, distance);
                var next = ny * field.Width + nx;
                var cost = costs[index] + (movement?.Invoke(from, p) ?? distance * (1 + grade * grade * 20 + field.Sample("ice", p) / 1000));
                if (cost >= costs[next]) continue;
                parents[next] = index;
                costs[next] = cost;
                queue.Enqueue(next, (cost, next));
            }
        }
        return [];

        int Index(Position p)
        {
            var x = Math.Clamp((int)Math.Round((p.X - field.Bounds[0]) / (field.Bounds[2] - field.Bounds[0]) * (field.Width - 1)), 0, field.Width - 1);
            var y = Math.Clamp((int)Math.Round((p.Y - field.Bounds[1]) / (field.Bounds[3] - field.Bounds[1]) * (field.Height - 1)), 0, field.Height - 1);
            return (from dy in Enumerable.Range(-1, 3)
                    from dx in Enumerable.Range(-1, 3)
                    let nx = x + dx
                    let ny = y + dy
                    where nx >= 0 && ny >= 0 && nx < field.Width && ny < field.Height
                    let point = field.PositionAt(nx, ny)
                    where shape.Contains(Spatial.Point(point)) && (Spatial.Point(p).Distance(Spatial.Point(point)) <= 1e-6 || shape.Covers(Spatial.Read(Spatial.Line([p, point]))))
                    orderby Spatial.Point(point).Distance(Spatial.Point(p))
                    select ny * field.Width + nx).First();
        }
        List<Position> Reconstruct()
        {
            var result = new List<Position>();
            for (var i = target; i >= 0; i = parents[i]) result.Add(field.PositionAt(i % field.Width, i / field.Width));
            result.Reverse();
            result[0] = start;
            result[^1] = end;
            return result.Count >= 2 && shape.Covers(Spatial.Read(Spatial.Line(result))) ? result : [];
        }
    }
}
