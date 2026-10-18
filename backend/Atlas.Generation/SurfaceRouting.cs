using Atlas.Domain;
using NetTopologySuite.Geometries;
using NetTopologySuite.Index.Strtree;
using NetTopologySuite.Operation.Union;
using System.Text.Json.Nodes;
using Position = Atlas.Domain.Position;

namespace Atlas.Generation;

public sealed class SurfaceRouting
{
    public sealed record Sink(int Cell, Guid? Body = null, (Guid FeatureId, Position Point, double Level)? Channel = null, bool External = false);
    private sealed record Segment(Geometry Geometry, Position A, double Head, double Tail);
    private sealed class Node(Position point, double head)
    {
        public Position Point = point;
        public double Head = head;
        public Sink? Sink;
        public List<int> Cells = [];
        public List<int> Neighbors = [];
        public int Receiver = -1;
        public int Destination = -1;
        public double Distance = double.PositiveInfinity;
        public double SinkHead = double.PositiveInfinity;
        public double Volume;
    }
    private readonly RegionalGrid grid;
    private readonly List<Node> nodes = [];
    private readonly Dictionary<string, int> identities = [];
    private readonly Dictionary<int, int> cells = [];
    private readonly HashSet<(int, int)> represented = [];
    private readonly List<int> upstream = [];
    private double duration;

    public SurfaceRouting(RegionalGrid grid, bool condition = false)
    {
        this.grid = grid;
        var segments = new List<Segment>(); var sinks = new List<(Position Point, double Head, Sink Sink)>();
        var area = Spatial.Read(grid.Area.Footprint);
        var channels = new STRtree<Feature>();
        foreach (var channel in grid.Waterways) channels.Insert(Spatial.Read(channel.Geometry).EnvelopeInternal, channel);
        var control = grid.Order.ToDictionary(i => i, i =>
        {
            var p = grid.Position(i);
            var box = Spatial.Read(Spatial.Rectangle(p.X - grid.Dx / 2, p.Y - grid.Dy / 2, grid.Dx, grid.Dy));
            if (area.Covers(box)) return p;
            var support = area.Intersection(box);
            var center = support.Centroid;
            if (!support.Covers(center)) center = support.InteriorPoint;
            return new Position(center.X, center.Y);
        });
        var lakeHeads = grid.Reservoirs.ToDictionary(p => p.Key, p => Level(p.Value));
        double Head(int i) => grid.LakeRoots.TryGetValue(i, out var root) ? Math.Max(grid["elevation"][i], lakeHeads[root]) : grid.Routing[i];
        foreach (var i in grid.Order)
        {
            var a = control[i];
            if (grid.Waters.Cells.TryGetValue(i, out var body))
            {
                var shape = Spatial.Read(grid.Waters.Basins[body].State.Footprint);
                var near = NetTopologySuite.Operation.Distance.DistanceOp.NearestPoints(shape, Spatial.Point(a))[0];
                var point = new Position(near.X, near.Y);
                Connect(i, a, point, Head(i), Head(i), new(i, Body: body));
            }
            else if (grid.TryChannel(i, out var channel))
            {
                Connect(i, a, channel.Point, Head(i), channel.Level, new(i, Channel: channel));
            }
            else if (grid.Receiver[i] >= 0)
            {
                var target = grid.Receiver[i];
                Connect(i, a, control[target], Head(i), Head(target));
            }
            else
            {
                var point = a;
                var external = !grid.Reservoirs.ContainsKey(i);
                if (external && !grid.Ocean[i])
                {
                    var near = NetTopologySuite.Operation.Distance.DistanceOp.NearestPoints(area.Boundary, Spatial.Point(a))[0];
                    point = new(near.X, near.Y);
                }
                Connect(i, a, point, Head(i), Head(i), new(i, External: external));
            }
        }
        void Connect(int cell, Position a, Position b, double head, double tail, Sink? destination = null)
        {
            var length = Spatial.Point(a).Distance(Spatial.Point(b));
            if (length > 1e-6)
            {
                var segment = Spatial.Read(Spatial.Line([a, b]));
                var hit = channels.Query(segment.EnvelopeInternal)
                    .SelectMany(f => segment.Intersection(Spatial.Read(f.Geometry)).Coordinates.Select(c => (Feature: f, Point: new Position(c.X, c.Y))))
                    .OrderBy(h => Spatial.Point(a).Distance(Spatial.Point(h.Point))).FirstOrDefault();
                if (hit.Feature is not null)
                {
                    b = hit.Point;
                    tail = Hydrology.ElevationAt(hit.Feature.Geometry, hit.Feature.Attributes, b) ?? tail;
                    var station = (hit.Feature.Id, b, tail);
                    grid.ChannelIntakes[cell] = station;
                    destination = new(cell, Channel: station);
                }
                if (Spatial.Point(a).Distance(Spatial.Point(b)) > 1e-6)
                    segments.Add(new(Spatial.Read(Spatial.Line([a, b])), a, head, tail));
            }
            if (destination is not null) sinks.Add((b, tail, destination));
        }
        var index = new STRtree<Segment>();
        foreach (var segment in segments) index.Insert(segment.Geometry.EnvelopeInternal, segment);
        var sinkHeads = sinks.GroupBy(s => Key(s.Point)).ToDictionary(g => g.Key, g => g.Min(s => s.Head));
        if (segments.Count > 0)
            foreach (var line in Composition.Parts(UnaryUnionOp.Union(segments.Select(s => s.Geometry).ToList())).OfType<LineString>())
                for (var p = 1; p < line.Coordinates.Length; p++)
                {
                    var a = At(new(line.Coordinates[p - 1].X, line.Coordinates[p - 1].Y));
                    var b = At(new(line.Coordinates[p].X, line.Coordinates[p].Y));
                    if (a == b) continue;
                    nodes[a].Neighbors.Add(b); nodes[b].Neighbors.Add(a);
                }
        foreach (var sink in sinks)
        {
            var i = At(sink.Point); nodes[i].Sink ??= sink.Sink; nodes[i].Head = sink.Head;
        }
        foreach (var cell in grid.Order)
        {
            var i = At(control[cell]); cells[cell] = i; nodes[i].Cells.Add(cell);
        }
        var queue = new PriorityQueue<int, (double, double, int)>();
        foreach (var i in Enumerable.Range(0, nodes.Count).Where(i => nodes[i].Sink is not null))
        {
            nodes[i].Destination = i; nodes[i].Distance = 0; nodes[i].SinkHead = nodes[i].Head;
            queue.Enqueue(i, (nodes[i].SinkHead, 0, i));
        }
        while (queue.TryDequeue(out var i, out var priority))
        {
            if (priority.Item1 != nodes[i].SinkHead || priority.Item2 != nodes[i].Distance) continue;
            foreach (var n in nodes[i].Neighbors)
            {
                if (nodes[n].Sink is not null) continue;
                var distance = nodes[i].Distance + Spatial.Point(nodes[i].Point).Distance(Spatial.Point(nodes[n].Point));
                var spill = Math.Max(nodes[n].Head, nodes[i].SinkHead);
                if (spill > nodes[n].SinkHead || spill == nodes[n].SinkHead && distance >= nodes[n].Distance) continue;
                nodes[n].SinkHead = spill; nodes[n].Distance = distance;
                nodes[n].Receiver = i; nodes[n].Destination = nodes[i].Destination;
                queue.Enqueue(n, (spill, distance, n));
            }
        }
        var missing = nodes.FirstOrDefault(n => n.Destination < 0);
        Guard.Require(missing is null, "surface_drainage", $"Surface flow at {missing?.Point}, head {missing?.Head}, lacks a downhill receiver; neighboring heads: {string.Join(", ", missing?.Neighbors.Select(n => $"{nodes[n].Head:G6} ({nodes[n].Sink})") ?? [])}.");
        foreach (var node in nodes) node.Head = node.SinkHead;
        upstream = Enumerable.Range(0, nodes.Count).OrderByDescending(i => nodes[i].SinkHead).ThenByDescending(i => nodes[i].Distance).ToList();
        foreach (var (cell, node) in cells) grid["basin"][cell] = nodes[nodes[node].Destination].Sink!.Cell;
        if (condition) foreach (var (cell, node) in cells) grid.Routing[cell] = Math.Max(grid["elevation"][cell], nodes[node].Head);

        int At(Position point)
        {
            point = Spatial.Quantize(point);
            var key = Key(point);
            if (identities.TryGetValue(key, out var known)) return known;
            var geometry = Spatial.Point(point); var envelope = geometry.EnvelopeInternal.Copy(); envelope.ExpandBy(1e-5);
            var heads = index.Query(envelope).Where(s => s.Geometry.Distance(geometry) < 1e-5).Select(s =>
            {
                var fraction = Math.Clamp(Spatial.Point(s.A).Distance(geometry) / s.Geometry.Length, 0, 1);
                return s.Head + (s.Tail - s.Head) * fraction;
            }).ToList();
            var head = sinkHeads.TryGetValue(key, out var fixedHead) ? fixedHead : heads.Count > 0 ? heads.Min() : grid.Routing[grid.Index(point)];
            identities[key] = nodes.Count; nodes.Add(new(point, head)); return nodes.Count - 1;
        }
        double Level(SurfaceReservoir lake)
        {
            var volume = lake.Cells.Sum(i => grid["surfaceStorage"][i] * grid.Measures[i]);
            var lo = lake.Cells.Min(i => grid["elevation"][i]); var hi = Math.Max(lo, lake.Spill);
            for (var pass = 0; pass < 50; pass++)
            {
                var mid = (lo + hi) / 2;
                if (lake.Cells.Sum(i => Math.Max(0, mid - grid["elevation"][i]) * grid.Measures[i]) > volume) hi = mid; else lo = mid;
            }
            return volume > 0 ? (lo + hi) / 2 : lo;
        }
    }

    public double Route(double[] supply, double[] lakeSupply, double[] captured, double years)
    {
        duration = years;
        foreach (var node in nodes) node.Volume = 0;
        foreach (var (cell, node) in cells) nodes[node].Volume += supply[cell];
        foreach (var i in upstream) if (nodes[i].Receiver >= 0) nodes[nodes[i].Receiver].Volume += nodes[i].Volume;
        double exported = 0;
        foreach (var node in nodes.Where(n => n.Sink is not null)) exported += Deliver(node.Sink!, node.Volume, lakeSupply, captured);
        Publish(); return exported;
    }
    public bool Contains(int cell) => cells.ContainsKey(cell);
    public Sink Destination(int cell) => nodes[nodes[cells[cell]].Destination].Sink!;
    public IEnumerable<int> CellsAlong(int cell)
    {
        for (var i = cells[cell]; i >= 0; i = nodes[i].Receiver)
            foreach (var source in nodes[i].Cells) yield return source;
    }
    public void RefreshHeads()
    {
        foreach (var node in nodes.Where(n => n.Sink is not null))
        {
            var sink = node.Sink!;
            if (sink.Body is { } body) node.Head = grid.Waters.Basins[body].Stage(grid.Waters.Basins[body].State.Volume);
            else if (sink.Channel is { } channel)
            {
                var feature = grid.Waterways.Single(f => f.Id == channel.FeatureId);
                node.Head = Hydrology.ElevationAt(feature.Geometry, feature.Attributes, channel.Point) ?? node.Head;
            }
            else if (!sink.External) node.Head = grid["waterSurface"][sink.Cell];
        }
        foreach (var i in upstream.AsEnumerable().Reverse())
            if (nodes[i].Receiver >= 0) nodes[i].Head = Math.Max(nodes[i].Head, nodes[nodes[i].Receiver].Head);
    }
    public double Add(int cell, double amount, double[] lakeSupply, double[] captured, bool deliver = true)
    {
        var i = cells[cell];
        while (true)
        {
            nodes[i].Volume += amount;
            if (nodes[i].Receiver < 0) break;
            i = nodes[i].Receiver;
        }
        Publish(); return deliver ? Deliver(nodes[i].Sink!, amount, lakeSupply, captured) : 0;
    }
    private double Deliver(Sink sink, double amount, double[] lakeSupply, double[] captured)
    {
        if (sink.Body is { } body) grid.Waters.Basins[body].Supply += amount;
        else if (sink.Channel is not null) captured[sink.Cell] += amount;
        else if (sink.External) return amount;
        else lakeSupply[sink.Cell] += amount;
        return 0;
    }
    private void Publish()
    {
        foreach (var (cell, node) in cells) grid["flow"][cell] = nodes[node].Volume / duration / RegionalGrid.SecondsPerYear;
    }
    public (double Produced, double Deposited, double Exported) Materials(double[] supply, double[] captured, double years, bool erode)
    {
        RefreshHeads();
        var load = new double[nodes.Count];
        foreach (var (cell, node) in cells) load[node] += supply[cell];
        double produced = 0, deposited = 0, exported = 0;
        foreach (var i in upstream)
        {
            var node = nodes[i];
            if (node.Sink is { } sink)
            {
                if (sink.Body is { } body) grid.ReceivingSediment[body] = grid.ReceivingSediment.GetValueOrDefault(body) + load[i];
                else if (sink.Channel is not null) captured[sink.Cell] += load[i];
                else if (sink.External) exported += load[i];
                else
                {
                    var root = grid.LakeRoots.GetValueOrDefault(sink.Cell, sink.Cell);
                    foreach (var cell in grid.Reservoirs[root].Cells.OrderBy(c => grid["elevation"][c]))
                    {
                        var amount = Math.Max(0, grid.AvailableChange("elevation", cell, Math.Min(grid["waterDepth"][cell], load[i] / grid.Measures[cell]))) * grid.Measures[cell];
                        Deposit(cell, amount); load[i] -= amount; deposited += amount;
                    }
                    grid["suspendedSediment"][sink.Cell] += load[i] / grid.Measures[sink.Cell];
                }
                continue;
            }
            var downstream = nodes[node.Receiver];
            var distance = Spatial.Point(node.Point).Distance(Spatial.Point(downstream.Point));
            var slope = Math.Max(0, node.Head - downstream.Head) / Math.Max(1e-8, distance);
            var equilibrium = Math.Pow(Math.Max(0, node.Volume / years / RegionalGrid.SecondsPerYear), .6) * Math.Sqrt(slope) * years * .05;
            foreach (var cell in node.Cells.Where(c => !grid.Fixed("elevation", c)))
            {
                grid["slope"][cell] = slope;
                if (load[i] < equilibrium && erode)
                {
                    var cut = Math.Min((equilibrium - load[i]) / grid.Measures[cell] / Math.Max(.05, grid["rock"][cell] / 1000),
                        Math.Max(0, node.Head - downstream.Head) * .1);
                    cut = -grid.AvailableChange("elevation", cell, -cut);
                    var loose = Math.Min(grid["sediment"][cell], cut);
                    grid["sediment"][cell] -= loose; grid["bedrock"][cell] -= cut - loose;
                    grid["elevation"][cell] -= cut; grid["erosion"][cell] += cut;
                    var amount = cut * grid.Measures[cell]; load[i] += amount; produced += amount;
                }
                else if (load[i] > equilibrium)
                {
                    var amount = Math.Max(0, grid.AvailableChange("elevation", cell, (load[i] - equilibrium) * .5 / grid.Measures[cell])) * grid.Measures[cell];
                    Deposit(cell, amount); load[i] -= amount; deposited += amount;
                }
            }
            load[node.Receiver] += load[i];
        }
        return (produced, deposited, exported);
        void Deposit(int cell, double amount)
        {
            grid["sediment"][cell] += amount / grid.Measures[cell];
            grid["elevation"][cell] += amount / grid.Measures[cell];
            grid["deposition"][cell] += amount / grid.Measures[cell];
        }
    }
    public List<FlowLink> Links()
    {
        var result = new List<FlowLink>();
        for (var i = 0; i < nodes.Count; i++)
            if (nodes[i].Receiver >= 0 && nodes[i].Volume > 0)
            {
                var a = nodes[i].Point; var b = nodes[nodes[i].Receiver].Point;
                result.Add(new(Registry.Identity(grid.Input.World.Id, $"surface-flow:{Key(a)}:{Key(b)}"), a, b,
                    nodes[i].Volume / duration / RegionalGrid.SecondsPerYear, represented.Contains((i, nodes[i].Receiver))));
            }
        return result;
    }
    public List<Feature> Features(Guid jobId, List<Feature> waters)
    {
        RefreshHeads();
        represented.Clear(); var result = new List<Feature>();
        var selected = nodes.Select(n => n.Receiver >= 0 && n.Volume / duration / RegionalGrid.SecondsPerYear >= .001).ToArray();
        var incoming = new int[nodes.Count];
        foreach (var i in upstream.Where(i => selected[i])) incoming[nodes[i].Receiver]++;
        foreach (var head in upstream.Where(i => selected[i] && incoming[i] != 1))
        {
            var destination = nodes[nodes[head].Destination].Sink!;
            if (grid.Area.Boundary is not null && destination is { External: true, Channel: null, Body: null } && !grid.Ocean[destination.Cell]) continue;
            var chain = new List<int> { head }; var i = head;
            while (nodes[i].Receiver >= 0)
            {
                i = nodes[i].Receiver; chain.Add(i);
                if (!selected[i] || incoming[i] != 1) break;
            }
            var geometry = Spatial.Line(chain.Select(i => nodes[i].Point));
            var relations = new List<Relation>();
            var sink = nodes[chain[^1]].Sink;
            if (sink?.Channel is { } channel) relations.Add(new(channel.FeatureId, "joins"));
            if (sink?.Body is { } body) relations.Add(new(body, "flowsInto"));
            if (sink is { Channel: null, Body: null })
            {
                var receiver = grid.Ocean[sink.Cell] ? grid.Input.World.Features.Values.FirstOrDefault(f => f.Kind == "ocean") :
                    waters.FirstOrDefault(f => f.Kind == "lake" && Spatial.Read(f.Geometry).Covers(Spatial.Point(nodes[chain[^1]].Point)));
                if (receiver is not null) relations.Add(new(receiver.Id, "flowsInto"));
            }
            var flow = chain.Select((i, n) => nodes[chain[Math.Min(n, chain.Count - 2)]].Volume / duration / RegionalGrid.SecondsPerYear).ToArray();
            var feature = HumanGeography.Generated(grid.Input.World, grid.Area, jobId, "Tributary", "river", "rivers", geometry,
                $"surface-drainage:{grid.Area.Id}:{Key(nodes[head].Point)}", new()
                {
                    ["flow"] = flow[^1],
                    ["flowUnits"] = "m3/s",
                    ["channelWidth"] = 2.5 * Math.Sqrt(flow[^1]),
                    ["elevations"] = Numbers(chain.Select(i => nodes[i].Head)),
                    ["discharges"] = Numbers(flow),
                    ["junctionInflows"] = Numbers(flow.Select((q, n) => n == 0 || n == flow.Length - 1 ? 0 : q - flow[n - 1]))
                }, relations);
            Refinement.ValidateRiver(feature, geometry); Refinement.ValidateCrossings(grid.Area, feature, geometry);
            result.Add(feature);
            for (var p = 1; p < chain.Count; p++) represented.Add((chain[p - 1], chain[p]));
        }
        return result;
    }
    private static JsonArray Numbers(IEnumerable<double> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
    private static string Key(Position point)
    {
        var p = Spatial.Quantize(point);
        return FormattableString.Invariant($"{p.X:R}:{p.Y:R}");
    }
}
