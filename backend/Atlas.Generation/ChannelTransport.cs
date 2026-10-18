using Atlas.Domain;
using NetTopologySuite.Geometries;
using NetTopologySuite.LinearReferencing;
using System.Text.Json.Nodes;
using Position = Atlas.Domain.Position;

namespace Atlas.Generation;

public sealed class ChannelTransport
{
    private sealed record Edge(int A, int B, Guid Feature, double Weight);
    private sealed class Node(Position point, double level)
    {
        public Position Point = point;
        public double Level = level;
        public double Supply;
        public double Exchange;
        public double Arriving;
        public double Outgoing;
        public List<Edge> Edges = [];
        public ReceivingWaters.Basin? Basin;
        public bool External;
    }
    private readonly RegionalGrid grid;
    private readonly List<Node> nodes = [];
    private readonly Dictionary<string, int> identities = [];
    private readonly Dictionary<int, int> cells = [];
    private readonly Dictionary<Guid, List<List<int>>> parts = [];
    private readonly Dictionary<(int, int, Guid), double> flows = [];
    private readonly List<int> order = [];
    private readonly Dictionary<Guid, int> lakeNodes = [];
    private readonly Dictionary<Guid, List<Position>> lakePaths = [];
    public ChannelTransport(RegionalGrid grid)
    {
        this.grid = grid;
        foreach (var feature in grid.Waterways)
        {
            parts[feature.Id] = [];
            foreach (var line in Composition.Parts(Spatial.Read(feature.Geometry)).OfType<LineString>())
            {
                var indexed = new LengthIndexedLine(line);
                var coordinates = line.Coordinates.Concat(grid.AllChannels.Select(c => c.Value).Where(c => c.FeatureId == feature.Id).Select(c => new Coordinate(c.Point.X, c.Point.Y)))
                    .Concat(grid.Area.Boundary?.Crossings.Where(c => c.FeatureId == feature.Id).Select(c => new Coordinate(c.Point.X, c.Point.Y)) ?? [])
                    .Where(c => line.Distance(new Point(c)) < 1e-5).OrderBy(c => indexed.Project(c)).DistinctBy(c => Key(new(c.X, c.Y))).ToList();
                var reference = grid.WaterwayReference.GetValueOrDefault(feature.Id, feature);
                var path = coordinates.Select(c => NodeAt(new(c.X, c.Y), Hydrology.ElevationAt(reference.Geometry, reference.Attributes, new(c.X, c.Y)) ?? 0)).ToList();
                parts[feature.Id].Add(path);
                for (var i = 1; i < path.Count; i++)
                    nodes[path[i - 1]].Edges.Add(new(path[i - 1], path[i], feature.Id, Math.Max(1e-12, Hydrology.DischargeAt(feature.Geometry, feature.Attributes, nodes[path[i - 1]].Point))));
            }
        }
        foreach (var (cell, channel) in grid.AllChannels) cells[cell] = identities[Key(channel.Point)];
        var channelCount = nodes.Count;
        foreach (var (id, basin) in grid.Waters.Basins)
        {
            var center = Spatial.Read(basin.State.Footprint).InteriorPoint;
            lakeNodes[id] = nodes.Count;
            nodes.Add(new(new(center.X, center.Y), basin.Stage(basin.State.Volume)) { Basin = basin });
        }
        for (var i = 0; i < channelCount; i++)
        {
            if (nodes[i].Edges.Count > 0) continue;
            var ends = grid.Waterways.Where(f => parts[f.Id].Any(p => p[^1] == i)).ToList();
            var point = Spatial.Point(nodes[i].Point);
            nodes[i].External = Spatial.Read(grid.Area.Footprint).Boundary.Distance(point) <= 1e-5 || grid.Ocean[grid.Index(nodes[i].Point)];
            if (nodes[i].External) continue;
            var receiving = ends.SelectMany(f => f.Relations.Where(r => r.Kind == "flowsInto")).Select(r => r.TargetId)
                .FirstOrDefault(id => lakeNodes.ContainsKey(id) && Spatial.Read(grid.Waters.Basins[id].State.Footprint).Distance(point) <= 1e-5);
            if (receiving != Guid.Empty) nodes[i].Edges.Add(new(i, lakeNodes[receiving], Guid.Empty, 1));
            else
            {
                nodes[i].External = ends.SelectMany(f => f.Relations.Where(r => r.Kind == "flowsInto"))
                    .Any(r => grid.Input.World.Features.GetValueOrDefault(r.TargetId) is { Kind: "ocean" } ocean && Composition.Geometry(grid.Input.World, ocean).Covers(point));
                Guard.Require(nodes[i].External, "unresolved_water_receiver", $"{string.Join(", ", ends.Select(f => f.Name))} at {nodes[i].Point} needs a located receiving water body or losing-reach storage mechanism; targets: {string.Join(", ", ends.SelectMany(f => f.Relations).Select(r => r.TargetId))}.");
            }
        }
        foreach (var (id, basin) in grid.Waters.Basins)
        {
            var node = lakeNodes[id];
            var path = basin.State.OutletPath ?? (basin.State.OutletFrom is { } from && basin.State.Outlet is { } to ? [from, to] : []);
            var target = -1; var limit = path.Count;
            for (var p = 1; p < path.Count; p++)
                if (identities.TryGetValue(Key(path[p]), out var existing)) { target = existing; limit = p + 1; break; }
            if (target < 0 && path.Count > 0)
            {
                var last = path[^1]; var point = Spatial.Point(last);
                var nextLake = grid.Waters.Basins.Values.FirstOrDefault(b => b.State.Id != id && Spatial.Read(b.State.Footprint).Covers(point));
                if (nextLake is not null) target = lakeNodes[nextLake.State.Id];
                else nodes[node].External = !Spatial.Read(grid.Area.Footprint).Contains(point) || grid.Ocean[grid.Index(last)] ||
                    grid.Input.World.Features.Values.Any(f => f.Kind == "ocean" && Composition.Geometry(grid.Input.World, f).Covers(point));
            }
            nodes[node].External |= basin.State.FixedLevel is not null;
            if (target >= 0) nodes[node].Edges.Add(new(node, target, Guid.Empty, 1));
            lakePaths[id] = path.Take(limit).ToList();
        }
        var indegree = new int[nodes.Count];
        foreach (var node in nodes) foreach (var edge in node.Edges) indegree[edge.B]++;
        var queue = new Queue<int>(Enumerable.Range(0, nodes.Count).Where(i => indegree[i] == 0));
        while (queue.TryDequeue(out var i)) { order.Add(i); foreach (var edge in nodes[i].Edges) if (--indegree[edge.B] == 0) queue.Enqueue(edge.B); }
        Guard.Require(order.Count == nodes.Count, "channel_cycle", "A regional channel solve needs an acyclic directed water network or a declared lift/storage process.");
    }

    public (double Inflow, double Outflow, double Storage, double SurfaceStorage, double Evaporation) Solve(double[] captured, double years)
    {
        grid.WaterTransfers.Clear();
        foreach (var node in nodes) { node.Supply = 0; node.Exchange = 0; }
        foreach (var (cell, node) in cells) nodes[node].Supply += captured[cell];
        double inflow = 0;
        foreach (var crossing in grid.Area.Boundary?.Crossings.Where(c => grid.IsPresent && c.Kind == "river" && c.Direction == "inlet") ?? [])
        {
            var volume = crossing.Flow * RegionalGrid.SecondsPerYear * years;
            nodes[identities[Key(crossing.Point)]].Supply += volume;
            inflow += volume;
        }
        var expected = new Dictionary<int, double>();
        foreach (var crossing in grid.Area.Boundary?.Crossings.Where(c => grid.IsPresent && c.Kind == "river" && c.Direction == "outlet") ?? [])
            expected[identities[Key(crossing.Point)]] = crossing.Flow * RegionalGrid.SecondsPerYear * years;
        Transport();
        foreach (var crossing in grid.Area.Boundary?.Crossings.Where(c => grid.IsPresent && c.Kind == "river" && c.Direction == "outlet") ?? [])
        {
            var node = identities[Key(crossing.Point)];
            var range = Hydrology.FlowRange(crossing);
            expected[node] = Math.Clamp(nodes[node].Outgoing, range.Minimum * RegionalGrid.SecondsPerYear * years, range.Maximum * RegionalGrid.SecondsPerYear * years);
        }
        var descendants = new Dictionary<int, Dictionary<int, double>>();
        foreach (var i in order.AsEnumerable().Reverse())
        {
            if (nodes[i].Edges.Count == 0) descendants[i] = new() { [i] = 1 };
            else
            {
                descendants[i] = [];
                var total = nodes[i].Edges.Sum(e => e.Weight);
                foreach (var edge in nodes[i].Edges)
                    foreach (var (outlet, share) in descendants[edge.B]) descendants[i][outlet] = descendants[i].GetValueOrDefault(outlet) + share * edge.Weight / total;
            }
        }
        // Bank storage solves each receiving basin's imposed flux. Conductance and finite pore capacity bound exchange.
        var banks = new Dictionary<int, List<(int Cell, double Capacity, double Conductance, double Release)>>();
        for (var i = 0; i < grid.Count; i++)
        {
            if (!grid.Interior[i] || grid.Fixed("groundwater", i)) continue;
            var root = (int)grid["basin"][i];
            if (!cells.TryGetValue(root, out var node)) continue;
            var porosity = .15 + Math.Clamp(grid["fracture"][i] / 5000, 0, .2);
            var activeDepth = Math.Max(.5, grid["sediment"][i] + Math.Clamp(grid["fracture"][i] / 1000, 0, 1) * 30);
            var aquiferBase = Math.Min(grid["elevation"][i] - activeDepth, nodes[node].Level);
            var head = aquiferBase + grid["groundwater"][i] / porosity;
            var capacity = Math.Max(0, nodes[node].Level - head) * porosity * grid.Measures[i];
            var conductivity = 1e-7 + 2e-5 * Math.Pow(Math.Clamp(grid["fracture"][i] / 1000, 0, 1), 2) + grid["carbonate"][i] * 1e-4;
            var distance = Math.Max(Math.Min(grid.Dx, grid.Dy), Spatial.Point(grid.Position(i)).Distance(Spatial.Point(nodes[node].Point)));
            var conductance = conductivity * grid.Measures[i] / distance * RegionalGrid.SecondsPerYear * years;
            capacity = Math.Min(capacity, Math.Max(0, nodes[node].Level - head) * conductance);
            var releaseHead = Math.Max(0, head - nodes[node].Level);
            var release = Math.Min(grid["groundwater"][i] * grid.Measures[i], Math.Min(releaseHead * conductance, releaseHead * porosity * grid.Measures[i]));
            if (!banks.ContainsKey(node)) banks[node] = [];
            banks[node].Add((i, capacity, conductance, release));
        }
        var withdrawals = new Dictionary<int, double>();
        for (var pass = 0; pass < 80; pass++)
        {
            var changed = false;
            foreach (var i in order)
            {
                if (!banks.TryGetValue(i, out var candidates)) continue;
                var residual = descendants[i].Where(v => expected.ContainsKey(v.Key)).ToList();
                if (residual.Count == 0) continue;
                var desired = residual.Sum(v => (nodes[v.Key].Outgoing - expected[v.Key]) * v.Value) / residual.Sum(v => v.Value * v.Value);
                double amount;
                if (desired >= 0)
                {
                    desired = Math.Min(desired, residual.Min(v => Math.Max(0, nodes[v.Key].Outgoing - expected[v.Key]) / v.Value));
                    var capacity = candidates.Sum(c => c.Capacity) - Math.Max(0, withdrawals.GetValueOrDefault(i));
                    amount = Math.Clamp(desired, 0, Math.Min(capacity, Math.Max(0, nodes[i].Outgoing)));
                }
                else
                {
                    var deficit = Math.Min(-desired, residual.Min(v => Math.Max(0, expected[v.Key] - nodes[v.Key].Outgoing) / v.Value));
                    var capacity = candidates.Sum(c => c.Release) + Math.Min(0, withdrawals.GetValueOrDefault(i));
                    amount = -Math.Clamp(deficit, 0, Math.Max(0, capacity));
                }
                if (Math.Abs(amount) <= 1e-8) continue;
                nodes[i].Exchange += amount; withdrawals[i] = withdrawals.GetValueOrDefault(i) + amount;
                changed = true; Transport();
            }
            if (!changed) break;
        }
        foreach (var (node, required) in expected)
            Guard.Require(Math.Abs(nodes[node].Outgoing - required) <= Math.Max(1e-4, required * 1e-8), "water_budget_conflict",
                FormattableString.Invariant($"The outlet at ({nodes[node].Point.X:F1}, {nodes[node].Point.Y:F1}) requires {required / years / RegionalGrid.SecondsPerYear:G5} m3/s; its connected basin supplies {nodes[node].Outgoing / years / RegionalGrid.SecondsPerYear:G5} m3/s after available bank storage. Reconcile its hydrological inputs or storage constraints."));
        double storage = 0;
        foreach (var (node, amount) in withdrawals)
        {
            var remaining = Math.Abs(amount);
            foreach (var bank in banks[node].OrderByDescending(b => b.Conductance))
            {
                var retained = Math.Min(remaining, amount >= 0 ? bank.Capacity : bank.Release);
                var signed = retained * Math.Sign(amount);
                grid["groundwater"][bank.Cell] += signed / grid.Measures[bank.Cell];
                remaining -= retained; storage += signed;
                if (remaining <= 1e-8) break;
            }
            var channelCell = cells.First(c => c.Value == node).Key;
            grid.TryChannel(channelCell, out var station);
            var source = station.FeatureId;
            grid.WaterTransfers.Add(new(source, nodes[node].Point, amount / years / RegionalGrid.SecondsPerYear,
                AquiferId(grid, source), grid.OutputId));
        }
        Backwater();
        Export(years);
        foreach (var cell in grid.Channels.Keys.ToList())
        {
            var channel = grid.Channels[cell];
            var feature = grid.Waterways.Single(f => f.Id == channel.FeatureId);
            grid.Channels[cell] = (channel.FeatureId, channel.Point, Hydrology.ElevationAt(feature.Geometry, feature.Attributes, channel.Point) ?? channel.Level);
        }
        double surfaceStorage = 0, evaporation = 0;
        foreach (var (id, node) in lakeNodes)
        {
            var basin = nodes[node].Basin!; var result = basin.Solved!;
            surfaceStorage += result.Volume - basin.State.Volume; evaporation += result.Evaporation; inflow += result.ExternalInflow;
            Guard.Require(nodes[node].Edges.Count > 0 || nodes[node].External || result.Outflow <= 1e-5,
                "unresolved_lake_spill", "A filling interior lake needs its actual downstream spill connection.");
            var path = lakePaths[id];
            for (var p = 1; p < path.Count; p++)
                grid.ReceivingLinks.Add(new(Registry.Identity(id, FormattableString.Invariant($"spill:{path[p - 1].X:R}:{path[p - 1].Y:R}:{path[p].X:R}:{path[p].Y:R}")),
                    path[p - 1], path[p], nodes[node].Outgoing / years / RegionalGrid.SecondsPerYear, false));
        }
        grid.Waters.Apply();
        return (inflow, nodes.Where(n => n.Edges.Count == 0 && n.External).Sum(n => n.Outgoing), storage, surfaceStorage, evaporation);
    }

    private void Transport()
    {
        foreach (var node in nodes) { node.Arriving = 0; node.Outgoing = 0; }
        flows.Clear();
        foreach (var i in order)
        {
            var node = nodes[i];
            node.Outgoing = node.Arriving + node.Supply - node.Exchange;
            if (node.Basin is { } basin)
            {
                basin.Solved = basin.Evaluate(node.Outgoing);
                node.Outgoing = basin.Solved.Outflow;
            }
            Guard.Require(node.Outgoing >= -1e-5, "channel_storage_conflict", "A channel exchange exceeds its upstream supply.");
            var total = node.Edges.Sum(e => e.Weight);
            foreach (var edge in node.Edges)
            {
                var volume = Math.Max(0, node.Outgoing) * edge.Weight / total;
                nodes[edge.B].Arriving += volume;
                flows[(edge.A, edge.B, edge.Feature)] = volume;
            }
        }
    }

    private void Backwater()
    {
        foreach (var i in order.AsEnumerable().Reverse())
        {
            var node = nodes[i];
            if (node.Basin is { } body)
            {
                node.Level = body.Stage(body.Solved!.Volume);
                continue;
            }
            var lakes = node.Edges.Where(e => nodes[e.B].Basin is not null).ToList();
            if (lakes.Count > 0) node.Level = lakes.Max(e => nodes[e.B].Level);
            else if (node.Edges.Count > 0) node.Level = Math.Max(node.Level, node.Edges.Max(e => nodes[e.B].Level));
            foreach (var crossing in grid.Area.Boundary?.Crossings.Where(c => c.Kind == "river" && Key(c.Point) == Key(node.Point)) ?? [])
                Guard.Require(Math.Abs(node.Level - crossing.Elevation) <= 1e-4, "backwater_boundary", "Receiving-water backwater conflicts with a fixed inlet/outlet level. Reconcile the water body and interface together.");
            foreach (var feature in grid.WaterwayReference.Values.Where(f => f.Protected || f.State is Materialization.Authored or Materialization.Protected))
                if (Spatial.Read(feature.Geometry).Distance(Spatial.Point(node.Point)) <= 1e-5)
                    Guard.Require(Math.Abs(node.Level - (Hydrology.ElevationAt(feature.Geometry, feature.Attributes, node.Point) ?? node.Level)) <= 1e-4,
                        "authored_water_level", "Receiving-water backwater conflicts with an authored waterway profile.");
        }
    }

    public (double Exported, double Deposited) Sediment(double[] captured, double years)
    {
        var load = new double[nodes.Count];
        foreach (var (cell, node) in cells) load[node] += captured[cell];
        foreach (var (id, node) in lakeNodes)
        {
            var basin = grid.Waters.Basins[id];
            load[node] += basin.State.Suspended + grid.ReceivingSediment.GetValueOrDefault(id); basin.State = basin.State with { Suspended = 0 };
        }
        double exported = 0, deposited = 0;
        var boundary = Spatial.Read(grid.Area.Footprint).Boundary;
        foreach (var i in order)
        {
            var node = nodes[i];
            if (node.Basin is { } basin)
            {
                var stage = basin.Stage(basin.State.Volume);
                var wetArea = basin.State.Slices.Where(s => s.Floor < stage).Sum(s => s.Area);
                var meanDepth = wetArea > 0 ? basin.State.Volume / wetArea : 0;
                var settling = load[i] * (1 - Math.Exp(-years * RegionalGrid.SecondsPerYear * 1e-6 / Math.Max(.05, meanDepth)));
                var remaining = Math.Min(settling, basin.State.Volume);
                var slices = basin.State.Slices.ToList();
                while (remaining > 1e-7 && slices.Any(s => s.Floor < stage - 1e-10))
                {
                    var thickness = remaining / slices.Where(s => s.Floor < stage - 1e-10).Sum(s => s.Area);
                    for (var s = 0; s < slices.Count; s++)
                    {
                        var depth = Math.Min(Math.Max(0, stage - slices[s].Floor), thickness);
                        var amount = depth * slices[s].Area;
                        slices[s] = slices[s] with { Floor = slices[s].Floor + depth, Sediment = slices[s].Sediment + depth };
                        remaining -= amount; load[i] -= amount; deposited += amount;
                    }
                }
                var waterOutflow = basin.Solved?.Outflow ?? 0;
                var fraction = Math.Clamp(waterOutflow / Math.Max(1e-20, basin.State.Volume + waterOutflow), 0, 1);
                var leaving = load[i] * fraction;
                basin.State = basin.State with { Slices = slices, Suspended = load[i] - leaving };
                if (node.Edges.Count == 0) exported += node.External ? leaving : 0;
                else foreach (var edge in node.Edges) load[edge.B] += leaving * edge.Weight / node.Edges.Sum(e => e.Weight);
                continue;
            }
            var external = node.Edges.Count == 0 && boundary.Distance(Spatial.Point(node.Point)) <= 1e-5;
            if (external) { exported += load[i]; continue; }
            var capacity = node.Edges.Sum(edge =>
            {
                var distance = Spatial.Point(node.Point).Distance(Spatial.Point(nodes[edge.B].Point));
                var slope = Math.Max(0, node.Level - nodes[edge.B].Level) / Math.Max(1e-8, distance);
                return Math.Pow(edge.Weight, .6) * Math.Sqrt(slope) * years * .05;
            });
            var excess = Math.Max(0, load[i] - capacity);
            if (excess > 0)
            {
                var center = grid.Index(node.Point);
                var discharge = Math.Max(0, node.Outgoing / years / RegionalGrid.SecondsPerYear);
                var bankDepth = .3 * Math.Pow(discharge, .3);
                var candidates = grid.Neighbors(center).Append(center).Where(c => grid.Interior[c] && !grid.Fixed("elevation", c))
                    .OrderBy(c => grid["elevation"][c]).ToList();
                foreach (var cell in candidates)
                {
                    var accommodation = Math.Max(0, node.Level + bankDepth - grid["elevation"][cell]);
                    var amount = Math.Max(0, grid.AvailableChange("elevation", cell, Math.Min(accommodation, excess / grid.Measures[cell]))) * grid.Measures[cell];
                    grid["elevation"][cell] += amount / grid.Measures[cell];
                    grid["sediment"][cell] += amount / grid.Measures[cell];
                    grid["deposition"][cell] += amount / grid.Measures[cell];
                    grid["floodplain"][cell] = Math.Max(grid["floodplain"][cell], accommodation);
                    grid["channelWidth"][center] = 2.5 * Math.Sqrt(discharge);
                    excess -= amount; load[i] -= amount; deposited += amount;
                    if (excess <= 1e-8) break;
                }
                if (node.Edges.Count == 0 && excess > 0)
                {
                    grid["suspendedSediment"][center] += excess / grid.Measures[center];
                    load[i] -= excess;
                }
            }
            var total = node.Edges.Sum(e => e.Weight);
            foreach (var edge in node.Edges) load[edge.B] += load[i] * edge.Weight / total;
        }
        return (exported, deposited);
    }

    private void Export(double years)
    {
        foreach (var feature in grid.Waterways)
        {
            var lines = new List<LineString>(); var heights = new List<double>(); var discharge = new List<double>(); var lateral = new List<double>();
            foreach (var path in parts[feature.Id])
            {
                lines.Add(new(path.Select(i => new Coordinate(nodes[i].Point.X, nodes[i].Point.Y)).ToArray()));
                for (var p = 0; p < path.Count; p++)
                {
                    var i = path[p];
                    var outgoing = p + 1 < path.Count ? flows[(i, path[p + 1], feature.Id)] : nodes[i].Outgoing;
                    var arriving = p > 0 ? flows[(path[p - 1], i, feature.Id)] : outgoing;
                    heights.Add(nodes[i].Level);
                    discharge.Add(outgoing / years / RegionalGrid.SecondsPerYear);
                    lateral.Add((outgoing - arriving) / years / RegionalGrid.SecondsPerYear);
                }
            }
            feature.Geometry = Spatial.Write(lines.Count == 1 ? lines[0] : new MultiLineString(lines.ToArray()));
            feature.Attributes["elevations"] = Numbers(heights); feature.Attributes["discharges"] = Numbers(discharge); feature.Attributes["junctionInflows"] = Numbers(lateral);
            feature.Attributes["waterExchange"] = new JsonObject { ["mechanism"] = "connected-bank-storage", ["volume"] = parts[feature.Id].SelectMany(p => p).Distinct().Sum(i => nodes[i].Exchange), ["years"] = years };
        }
    }
    private int NodeAt(Position point, double level)
    {
        point = Spatial.Quantize(point);
        var key = Key(point);
        if (identities.TryGetValue(key, out var existing)) return existing;
        identities[key] = nodes.Count; nodes.Add(new(point, level)); return nodes.Count - 1;
    }
    private static string Key(Position point)
    {
        var p = Spatial.Quantize(point);
        return FormattableString.Invariant($"{p.X:R}:{p.Y:R}");
    }
    public static Guid AquiferId(RegionalGrid grid, Guid channel) => Registry.Identity(grid.Input.World.Id, $"aquifer:{grid.Area.Id}:{channel}");
    private static JsonArray Numbers(IEnumerable<double> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
}
