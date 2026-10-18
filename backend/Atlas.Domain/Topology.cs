using NetTopologySuite.Geometries;
using NetTopologySuite.Index.Strtree;
using NetTopologySuite.LinearReferencing;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Atlas.Domain;

public static class Topology
{
    public static Guid Identity(Guid world, string key) => new(SHA256.HashData(Encoding.UTF8.GetBytes($"{world}:{key}")).AsSpan(0, 16));

    public static string Direction(JsonObject geometry, JsonObject footprint, Position crossing)
    {
        var shape = Spatial.Read(footprint);
        foreach (var line in Composition.Parts(Spatial.Read(geometry)).OfType<LineString>())
        {
            if (line.Distance(Spatial.Point(crossing)) > 1e-5) continue;
            var indexed = new LengthIndexedLine(line);
            var along = indexed.Project(new(crossing.X, crossing.Y));
            var delta = Math.Max(1e-7, line.Length * 1e-7);
            var before = shape.Contains(new Point(indexed.ExtractPoint(Math.Max(0, along - delta))));
            var after = shape.Contains(new Point(indexed.ExtractPoint(Math.Min(line.Length, along + delta))));
            if (before != after) return before ? "outlet" : "inlet";
        }
        return "touch";
    }

    public static void ValidateCurrent(World world, IEnumerable<Guid> affected)
    {
        var ids = affected.ToHashSet();
        foreach (var transfer in world.WaterTransfers.Values.SelectMany(v => v).Where(t => ids.Contains(t.FeatureId)))
            Guard.Require(world.Features.TryGetValue(transfer.FeatureId, out var channel) &&
                Composition.Geometry(world, channel).Distance(Spatial.Point(transfer.Position)) <= 1e-5,
                "attached_water_transfer", "This edit detaches a physical water-storage transfer. Reconcile the channel and storage together.");
        foreach (var connection in world.Connections.Values)
            foreach (var end in new[] { connection.A, connection.B }.Where(e => e.FeatureId is { } id && ids.Contains(id)))
                Guard.Require(world.Features.TryGetValue(end.FeatureId!.Value, out var attached) &&
                    Composition.Geometry(world, attached).Distance(Spatial.Point(end.Position)) <= 1e-5,
                    "attached_connection", "This edit detaches an existing entrance or network connection. Reconcile the connected objects together.");
        foreach (var group in world.NetworkReaches.Values.SelectMany(r => new[] { (Node: r.Start, r.FeatureId), (Node: r.End, r.FeatureId) }).GroupBy(v => v.Node))
        {
            if (group.Select(v => v.FeatureId).Distinct().Count() < 2) continue;
            foreach (var id in group.Select(v => v.FeatureId).Distinct().Where(ids.Contains))
                Guard.Require(world.Features.TryGetValue(id, out var joined) &&
                    Composition.Geometry(world, joined).Distance(Spatial.Point(world.NetworkNodes[group.Key].Position)) <= 1e-5,
                    "locked_junction", "An ordinary edit must preserve its shared network junctions.");
        }
    }

    public static void ValidateContracts(World world, IEnumerable<Guid> affected)
    {
        foreach (var id in affected)
        {
            if (!world.Features.TryGetValue(id, out var feature))
            {
                Guard.Require(!world.Areas.Values.Any(a => a.Boundary?.Crossings.Any(c => c.FeatureId == id) == true),
                    "locked_boundary", "Generation cannot remove a contracted network feature.");
                continue;
            }
            var geometry = Composition.Geometry(world, feature);
            var resolved = AtlasJson.Clone(feature);
            resolved.Geometry = Spatial.Write(geometry);
            resolved.Attributes = Composition.Attributes(world, feature, geometry, feature.AreaId);
            Refinement.ValidateRiver(resolved, resolved.Geometry);
            foreach (var area in world.Areas.Values.Where(a => Composition.Space(world, a.Id) == Composition.Space(world, feature.AreaId)))
                Refinement.ValidateCrossings(area, resolved, resolved.Geometry);
        }
    }

    public static void Rebuild(World world)
    {
        var previousNodes = world.NetworkNodes.Values.ToList();
        var previousReaches = world.NetworkReaches.Values.ToList();
        var knownNodes = previousNodes.ToDictionary(n => Key(n.Kind, n.SpaceId, n.Position), n => n.Id);
        var lines = world.Features.Values.Where(f => f.Kind is "river" or "road" or "cave")
            .SelectMany(f => Composition.Parts(Composition.Geometry(world, f)).OfType<LineString>()
                .Select(line => new NetworkLine(f, line, Composition.Space(world, f.AreaId)))).ToList();
        var index = new STRtree<NetworkLine>();
        foreach (var line in lines) index.Insert(line.Geometry.EnvelopeInternal, line);
        world.NetworkNodes.Clear();
        world.NetworkReaches.Clear();
        foreach (var entry in lines)
        {
            var singleLine = lines.Count(line => line.Feature.Id == entry.Feature.Id) == 1;
            var linear = new LengthIndexedLine(entry.Geometry);
            var resolved = Composition.ForArea(world, entry.Feature, entry.Feature.AreaId)!;
            var anchors = new SortedSet<double> { 0, entry.Geometry.Length };
            foreach (var other in index.Query(entry.Geometry.EnvelopeInternal).Where(o => o != entry && o.Space == entry.Space && o.Feature.Kind == entry.Feature.Kind))
                foreach (var coordinate in entry.Geometry.Intersection(other.Geometry).Coordinates) anchors.Add(linear.Project(coordinate));
            foreach (var connection in world.Connections.Values)
                foreach (var end in new[] { connection.A, connection.B }.Where(e => e.FeatureId == entry.Feature.Id))
                    anchors.Add(linear.Project(new(end.Position.X, end.Position.Y)));
            var positions = anchors.ToList();
            for (var i = 1; i < positions.Count; i++)
            {
                if (positions[i] - positions[i - 1] < 1e-7) continue;
                var a = Node(linear.ExtractPoint(positions[i - 1]));
                var b = Node(linear.ExtractPoint(positions[i]));
                var id = Identity(entry.Feature.Id, $"reach:{a}:{b}");
                world.NetworkReaches[id] = new(id, entry.Feature.Id, a, b,
                    Spatial.Write(linear.ExtractLine(positions[i - 1], positions[i])),
                    Hydrology.DischargeAt(resolved.Geometry, resolved.Attributes, world.NetworkNodes[a].Position),
                    Hydrology.DischargeAt(resolved.Geometry, resolved.Attributes, world.NetworkNodes[b].Position, arriving: true));
            }

            Guid Node(Coordinate coordinate)
            {
                var p = new Position(coordinate.X, coordinate.Y);
                var key = Key(entry.Feature.Kind, entry.Space, p);
                var id = knownNodes.GetValueOrDefault(key);
                if (id == Guid.Empty) id = EndpointIdentity(p) ?? Identity(world.Id, key);
                if (world.NetworkNodes.TryGetValue(id, out var assigned) &&
                    Spatial.Point(assigned.Position).Distance(Spatial.Point(p)) > 1e-6)
                    id = Identity(world.Id, key);
                knownNodes[key] = id;
                var height = entry.Feature.Kind == "river" ? Hydrology.ElevationAt(resolved.Geometry, resolved.Attributes, p) : null;
                if (world.NetworkNodes.TryGetValue(id, out var existing) && height is { } level && existing.WaterLevel is { } other)
                    Guard.Require(Math.Abs(level - other) <= 1e-4, "junction_water_level", FormattableString.Invariant($"At ({p.X:F2}, {p.Y:F2}), {entry.Feature.Name} meets a waterway at incompatible water levels ({level:F4} versus {other:F4})."));
                world.NetworkNodes[id] = new(id, entry.Feature.Kind, p with { Z = height ?? 0 }, entry.Space, height);
                return id;
            }

            Guid? EndpointIdentity(Position point)
            {
                if (!singleLine) return null;
                var old = previousReaches.Where(r => r.FeatureId == entry.Feature.Id).ToList();
                var starts = old.Select(r => r.Start).Except(old.Select(r => r.End)).ToList();
                var ends = old.Select(r => r.End).Except(old.Select(r => r.Start)).ToList();
                if (starts.Count == 1 && Spatial.Point(point).Distance(new Point(entry.Geometry.Coordinates[0])) < 1e-6) return starts[0];
                if (ends.Count == 1 && Spatial.Point(point).Distance(new Point(entry.Geometry.Coordinates[^1])) < 1e-6) return ends[0];
                return null;
            }
        }
        ValidateWaterNetwork(world);
    }

    private static string Key(string kind, Guid? space, Position point)
    {
        var p = Spatial.Quantize(point);
        return FormattableString.Invariant($"node:{space}:{kind}:{p.X:R}:{p.Y:R}");
    }

    private static void ValidateWaterNetwork(World world)
    {
        var rivers = world.NetworkReaches.Values.Where(r => world.Features[r.FeatureId].Kind == "river").ToList();
        var outgoing = rivers.GroupBy(r => r.Start).ToDictionary(g => g.Key, g => g.ToList());
        var incoming = rivers.GroupBy(r => r.End).ToDictionary(g => g.Key, g => g.ToList());
        foreach (var (id, reaches) in outgoing)
        {
            var supplied = incoming.GetValueOrDefault(id)?.Sum(r => r.EndFlow ?? r.Flow) ?? 0;
            var transfers = world.WaterTransfers.Values.SelectMany(v => v).Where(t =>
                Spatial.Point(t.Position).Distance(Spatial.Point(world.NetworkNodes[id].Position)) < 1e-5).ToList();
            foreach (var transfer in transfers)
                Guard.Require(double.IsFinite(transfer.Rate) && world.Features.TryGetValue(transfer.StorageId, out var storage) && storage.Kind is "aquifer" or "lake" &&
                    world.Fields.Any(f => f.Id == transfer.FieldId && f.Channels?.Contains("groundwater") == true),
                    "water_storage", "Water transfers must resolve to a materialized physical storage field and receiving water body.");
            Guard.Require(reaches.Sum(r => r.Flow) + transfers.Sum(t => t.Rate) + 1e-6 >= supplied,
                "water_budget", $"The water junction at {world.NetworkNodes[id].Position} receives {supplied:G8} m3/s and sends {reaches.Sum(r => r.Flow):G8} m3/s with {transfers.Sum(t => t.Rate):G8} m3/s of declared storage exchange. Incoming: {string.Join(", ", incoming.GetValueOrDefault(id)?.Select(r => $"{world.Features[r.FeatureId].Name} ({r.EndFlow ?? r.Flow:G8})") ?? [])}; outgoing: {string.Join(", ", reaches.Select(r => $"{world.Features[r.FeatureId].Name} ({r.Flow:G8})"))}.");
        }
        var complete = new HashSet<Guid>();
        var path = new HashSet<Guid>();
        foreach (var node in outgoing.Keys) Visit(node);
        void Visit(Guid node)
        {
            if (complete.Contains(node)) return;
            Guard.Require(path.Add(node), "water_cycle", "A flowing water network cannot circulate without an explicit pumping mechanism.");
            foreach (var reach in outgoing.GetValueOrDefault(node) ?? [])
                if (world.Features[reach.FeatureId].Attributes["liftCause"] is null) Visit(reach.End);
            path.Remove(node);
            complete.Add(node);
        }
    }

    private sealed record NetworkLine(Feature Feature, LineString Geometry, Guid? Space);
}
