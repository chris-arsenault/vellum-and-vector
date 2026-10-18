using Atlas.Domain;
using Engine.WorldGen;

namespace Atlas.Generation;

public interface IMagicMesh
{
    int Count { get; }
    Position Position(int index);
    IEnumerable<int> Neighbors(int index);
    double Value(string field, int index);
}

public static class MagicPropagation
{
    public static double[] Solve(MagicRule rule, IMagicMesh mesh, int epoch)
    {
        var result = new double[mesh.Count];
        if (epoch < rule.StartsAtEpoch) return result;
        var source = Enumerable.Range(0, mesh.Count).MinBy(i => Distance(mesh.Position(i), rule.Source));
        var distances = Enumerable.Repeat(double.PositiveInfinity, mesh.Count).ToArray();
        var queue = new PriorityQueue<int, (double, int)>();
        distances[source] = Distance(mesh.Position(source), rule.Source);
        queue.Enqueue(source, (distances[source], source));
        var scope = rule.Scope is { } geometry ? Spatial.Read(geometry) : null;
        while (queue.TryDequeue(out var index, out var priority))
        {
            if (priority.Item1 > distances[index] || priority.Item1 >= rule.Radius) continue;
            var p = mesh.Position(index);
            if (scope is not null && !scope.Covers(Spatial.Point(p))) continue;
            var medium = Medium(rule, mesh, index);
            if (medium <= 0) continue;
            var decay = Math.Pow(1 - rule.Decay, epoch - rule.StartsAtEpoch);
            result[index] = rule.Strength * Math.Pow(1 - priority.Item1 / rule.Radius, 2) * decay;
            foreach (var next in mesh.Neighbors(index))
            {
                var conductance = (medium + Medium(rule, mesh, next)) / 2;
                if (rule.Propagation == "ocean")
                {
                    var q = mesh.Position(next); var dx = q.X - p.X; var dy = q.Y - p.Y;
                    var cx = mesh.Value("oceanCurrentX", index); var cy = mesh.Value("oceanCurrentY", index);
                    var alignment = (cx * dx + cy * dy) / Math.Max(1, Math.Sqrt((cx * cx + cy * cy) * (dx * dx + dy * dy)));
                    conductance *= 1 + .5 * alignment;
                }
                if (conductance <= 0) continue;
                var distance = distances[index] + Distance(p, mesh.Position(next)) / conductance;
                if (distance >= distances[next]) continue;
                distances[next] = distance;
                queue.Enqueue(next, (distance, next));
            }
        }
        return result;
    }

    private static double Medium(MagicRule rule, IMagicMesh mesh, int index) => rule.Propagation switch
    {
        "fracture" => 0.15 + mesh.Value("fracture", index) / 1000,
        "cold" => 0.15 + Math.Max(0, 1000 - mesh.Value("temperature", index)) / 1000 + mesh.Value("ice", index) / (1 + mesh.Value("ice", index)),
        "ocean" => mesh.Value("water", index) == 1 || mesh.Value("water", index) == 0 && mesh.Value("elevation", index) < 0
            ? .25 + Math.Sqrt(Math.Max(0, mesh.Value("waterDepth", index))) / 10 : 0,
        _ => 1
    };
    private static double Distance(Position a, Position b) => Math.Sqrt(Math.Pow(a.X - b.X, 2) + Math.Pow(a.Y - b.Y, 2));
}

public sealed class PhysicalMagicMesh(PhysicalGeographyField field, Func<int, Position> locate) : IMagicMesh
{
    public int Count => field.Grid.TriangleCount;
    public Position Position(int index) => locate(index);
    public IEnumerable<int> Neighbors(int index)
    {
        for (var edge = 0; edge < 3; edge++)
        {
            var neighbor = field.Grid.NeighborTriangleIndex(index, edge);
            if (neighbor >= 0) yield return neighbor;
        }
    }
    public double Value(string key, int index) => key switch
    {
        "fracture" => field.FractureConductance[index],
        "temperature" => field.Temperature[index],
        "elevation" => (field.Elevation[index] - field.EffectiveSeaLevel) / 1024d,
        "water" => field.WaterKindCodes[index],
        "waterDepth" => field.WaterDepths[index] / 1024d,
        "ice" => field.IceThickness[index] / 3d,
        "oceanCurrentX" => field.OceanCurrentX[index],
        "oceanCurrentY" => field.OceanCurrentY[index],
        _ => 0
    };
}

public sealed class RasterMagicMesh(FieldData field) : IMagicMesh
{
    public int Count => field.Width * field.Height;
    public Position Position(int index) => field.PositionAt(index % field.Width, index / field.Width);
    public IEnumerable<int> Neighbors(int index)
    {
        var x = index % field.Width; var y = index / field.Width;
        if (x > 0) yield return index - 1;
        if (x < field.Width - 1) yield return index + 1;
        if (y > 0) yield return index - field.Width;
        if (y < field.Height - 1) yield return index + field.Width;
    }
    public double Value(string key, int index) => field.Values.TryGetValue(key, out var values) ? values[index] : 0;
}
