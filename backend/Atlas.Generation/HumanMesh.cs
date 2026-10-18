using Atlas.Domain;
using NetTopologySuite.Geometries;
using NetTopologySuite.Index.Strtree;
using NetTopologySuite.Operation.Union;
using Position = Atlas.Domain.Position;

namespace Atlas.Generation;

public sealed class HumanMesh
{
    public FieldData Physical { get; }
    public Area Area { get; }
    public List<int> Cells { get; } = [];
    public double[] Measures { get; }
    public double[] Capacity { get; }
    public List<(int To, double Cost)>[] Links { get; }
    private readonly Geometry shape;
    private readonly Dictionary<int, Geometry> supports = [];
    public double Scale { get; }
    public HumanMesh(GenerationInput input, FieldData physical)
    {
        Physical = physical; Area = input.World.Areas[input.Request.AreaId]; shape = Spatial.Read(Area.Footprint);
        var count = physical.Width * physical.Height;
        Measures = new double[count]; Capacity = new double[count]; Links = Enumerable.Range(0, count).Select(_ => new List<(int, double)>()).ToArray();
        var dx = (physical.Bounds[2] - physical.Bounds[0]) / (physical.Width - 1); var dy = (physical.Bounds[3] - physical.Bounds[1]) / (physical.Height - 1);
        Scale = Math.Sqrt(shape.Area);
        for (var i = 0; i < count; i++)
        {
            var p = Point(i);
            var box = Spatial.Read(Spatial.Rectangle(p.X - dx / 2, p.Y - dy / 2, dx, dy));
            if (!shape.Intersects(box)) continue;
            var support = shape.Covers(box) ? box : shape.Intersection(box);
            if (support.Area <= 0) continue;
            supports[i] = support; Measures[i] = support.Area; Cells.Add(i);
            Capacity[i] = Suitability(p) * 120 * support.Area / 1_000_000;
        }
        var roads = new STRtree<Geometry>();
        foreach (var feature in input.World.Features.Values.Where(f => f.Kind is "road" or "route"))
        {
            var line = Composition.Geometry(input.World, feature); roads.Insert(line.EnvelopeInternal, line);
        }
        foreach (var i in Cells)
        {
            var x = i % physical.Width; var y = i / physical.Width; var a = Point(i);
            foreach (var (nx, ny) in new[] { (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1) })
            {
                if (nx < 0 || ny < 0 || nx >= physical.Width || ny >= physical.Height) continue;
                var next = ny * physical.Width + nx;
                if (Measures[next] <= 0) continue;
                var b = Point(next); var line = Spatial.Read(Spatial.Line([a, b]));
                if (!shape.Covers(line)) continue;
                var distance = line.Length;
                var grade = Math.Abs(Value("elevation", i) - Value("elevation", next)) / Math.Max(1, distance);
                var cost = distance * (1 + grade * 15 + Math.Max(Value("ice", i), Value("ice", next)) / 20);
                if (Value("water", i) > 0 || Value("water", next) > 0 || Value("elevation", i) < 0 || Value("elevation", next) < 0) cost *= 12;
                else cost /= 1 + Math.Log(1 + Math.Min(Value("flow", i), Value("flow", next))) * .1;
                if (roads.Query(line.EnvelopeInternal).Any(r => r.Intersects(line))) cost *= .35;
                Links[i].Add((next, Math.Max(1e-5, cost)));
            }
        }
    }
    public Position Point(int cell) => Physical.PositionAt(cell % Physical.Width, cell / Physical.Width);
    public double Value(string field, int cell) => Physical.Sample(field, Point(cell));
    public Geometry Support(int cell) => supports[cell];
    public Geometry Polygon(IEnumerable<int> cells)
    {
        var pieces = cells.Select(Support).ToList();
        return pieces.Count == 0 ? Spatial.Factory.CreatePolygon() : UnaryUnionOp.Union(pieces);
    }
    public int Nearest(Position point, bool habitable = true) => Cells.Where(i => !habitable || Capacity[i] > 0)
        .DefaultIfEmpty(Cells[0]).MinBy(i => Spatial.Point(Point(i)).Distance(Spatial.Point(point)));
    public double Suitability(Position p)
    {
        if (Physical.Sample("elevation", p) < 0 || Physical.Sample("water", p) > 0) return 0;
        var water = .2 + Math.Clamp(Physical.Sample("moisture", p) / 800, 0, 1) + Math.Log(1 + Physical.Sample("flow", p)) * .05;
        var climate = Math.Exp(-Math.Abs(Physical.Sample("temperature", p) - 420) / 350);
        var ice = Math.Exp(-Physical.Sample("ice", p) / 5);
        var hazard = Physical.Values.Where(v => v.Key.StartsWith("magic:", StringComparison.Ordinal)).Sum(v => Math.Abs(Physical.Sample(v.Key, p))) / 2000;
        return water * climate * ice / (1 + hazard) * Math.Exp(-Math.Max(0, Physical.Sample("elevation", p)) / 2500);
    }
    public double[] Distances(int origin, Func<int, int, double>? modifier = null)
    {
        var costs = Enumerable.Repeat(double.PositiveInfinity, Measures.Length).ToArray();
        var queue = new PriorityQueue<int, (double, int)>(); costs[origin] = 0; queue.Enqueue(origin, (0, origin));
        while (queue.TryDequeue(out var i, out var priority))
        {
            if (priority.Item1 != costs[i]) continue;
            foreach (var (next, distance) in Links[i])
            {
                var value = costs[i] + distance * (modifier?.Invoke(i, next) ?? 1);
                if (value >= costs[next]) continue;
                costs[next] = value; queue.Enqueue(next, (value, next));
            }
        }
        return costs;
    }
    public static FieldData Historical(FieldData current, SampledPatch past) => current with
    {
        Values = current.Values.ToDictionary(v => v.Key, v => Enumerable.Range(0, v.Value.Length)
            .Select(i => past.Values.ContainsKey(v.Key) ? past.Sample(v.Key, current.PositionAt(i % current.Width, i / current.Width)) : v.Value[i]).ToArray()),
        WaterBodies = past.WaterBodies
    };
}
