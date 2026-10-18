using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Union;
using System.Text.Json.Nodes;

namespace Atlas.Domain;

public sealed record AnalysisRequest(Guid AreaId, string Operation, JsonObject? Geometry = null, Guid? FeatureId = null,
    Guid? TargetFeatureId = null, string? Layer = null, string? Channel = null, double Distance = 0, string NetworkKind = "road");
public sealed record AnalysisResult(JsonObject? Geometry, Dictionary<string, double> Measurements, List<Guid> Features,
    List<Guid> Areas, List<Guid> Path, List<string> Notes, long WorldVersion);

public static class SpatialAnalysis
{
    public static AnalysisResult Run(World world, AnalysisRequest request, IReadOnlyList<FieldData> fields)
    {
        Guard.Require(world.Areas.TryGetValue(request.AreaId, out var area), "missing_area", "Choose a mapped area for analysis.");
        var selected = request.FeatureId is { } id ? world.Features.GetValueOrDefault(id) : null;
        var geometry = request.Geometry is { } input ? Spatial.Read(input) : selected is not null ? Composition.Geometry(world, selected) : Spatial.Read(area!.Footprint);
        var measurements = new Dictionary<string, double>(); var ids = new List<Guid>(); var areas = new List<Guid>(); var path = new List<Guid>(); var notes = new List<string>();
        switch (request.Operation)
        {
            case "measure":
                measurements[geometry.Dimension == Dimension.Surface ? "perimeter_m" : "length_m"] = geometry.Length;
                measurements["area_m2"] = geometry.Area; break;
            case "buffer":
                Guard.Require(double.IsFinite(request.Distance), "analysis_distance", "Buffer distance must be finite.");
                geometry = geometry.Buffer(request.Distance); measurements["area_m2"] = geometry.Area; break;
            case "intersect":
                Guard.Require(request.TargetFeatureId is { } target && world.Features.ContainsKey(target), "analysis_target", "Select an intersecting target feature.");
                geometry = geometry.Intersection(Composition.Geometry(world, world.Features[request.TargetFeatureId!.Value]));
                measurements["area_m2"] = geometry.Area; measurements["length_m"] = geometry.Length; break;
            case "nearby":
                Guard.Require(double.IsFinite(request.Distance) && request.Distance >= 0, "analysis_distance", "Search distance must be nonnegative.");
                ids.AddRange(world.Features.Values.Where(f => Composition.Visible(world, f, area!.Id) && (request.Layer is null || f.LayerId == request.Layer))
                    .Where(f => Composition.Geometry(world, f).Distance(geometry) <= request.Distance).Select(f => f.Id));
                measurements["feature_count"] = ids.Count; break;
            case "fieldStatistics":
                Guard.Require(request.Channel is { Length: > 0 }, "analysis_channel", "Choose a materialized field channel.");
                var scope = geometry.Dimension == Dimension.Surface ? geometry.Intersection(Spatial.Read(area!.Footprint)) : geometry.Buffer(Math.Max(.5, request.Distance)).Intersection(Spatial.Read(area!.Footprint));
                var extrema = new List<double>(); double weighted = 0, measure = 0;
                foreach (var field in fields.Where(f => f.Values.ContainsKey(request.Channel!) && Composition.Space(world, f.AreaId) == Composition.Space(world, area.Id)))
                {
                    var coverage = FieldComposition.CoverageGeometry(world, field, request.Channel!).Intersection(scope);
                    if (coverage.IsEmpty) continue;
                    extrema.AddRange(FieldLimits.Extrema(field, request.Channel!, coverage));
                    var dx = (field.Bounds[2] - field.Bounds[0]) / (field.Width - 1); var dy = (field.Bounds[3] - field.Bounds[1]) / (field.Height - 1);
                    for (var i = 0; i < field.Width * field.Height; i++)
                    {
                        var p = field.PositionAt(i % field.Width, i / field.Width);
                        var cell = Spatial.Read(Spatial.Rectangle(p.X - dx / 2, p.Y - dy / 2, dx, dy));
                        if (!coverage.Intersects(cell)) continue;
                        var support = coverage.Intersection(cell).Area; weighted += field.Sample(request.Channel!, p) * support; measure += support;
                    }
                }
                Guard.Require(extrema.Count > 0 && measure > 0, "unmaterialized_field", "No materialized field covers this analysis area in the current space.");
                measurements["minimum"] = extrema.Min(); measurements["maximum"] = extrema.Max(); measurements["sample_weighted_mean"] = weighted / measure; measurements["sampled_area_m2"] = measure;
                geometry = scope; notes.Add("The mean weights sampled control volumes by their clipped area."); break;
            case "dependencies":
                Guard.Require(selected is not null, "analysis_feature", "Select a feature to inspect its dependencies.");
                ids.AddRange(Dependencies.Affected(world, [selected!.Id]));
                areas.AddRange(world.Areas.Values.Where(a => ids.Any(id => world.Features[id].AreaId == a.Id || world.Features[id].Detail.ContainsKey(a.Id)) || a.Boundary?.Crossings.Any(c => ids.Contains(c.FeatureId)) == true).Select(a => a.Id));
                measurements["feature_count"] = ids.Count; measurements["area_count"] = areas.Count; break;
            case "networkPath":
                Guard.Require(request.TargetFeatureId is { } endpoint && world.Features.ContainsKey(endpoint), "analysis_target", "Choose a destination feature.");
                Guard.Require(request.NetworkKind is "road" or "river" or "cave", "network_kind", "Choose road, river or cave routing.");
                var reaches = world.NetworkReaches.Values.Where(r => world.Features[r.FeatureId].Kind == request.NetworkKind &&
                    Composition.Space(world, world.Features[r.FeatureId].AreaId) == Composition.Space(world, area!.Id) && world.Features[r.FeatureId].Attributes["passable"]?.GetValue<bool>() != false).ToList();
                Guard.Require(reaches.Count > 0, "network_path", "No passable materialized network exists in this space.");
                var nodes = reaches.SelectMany(r => new[] { r.Start, r.End }).Distinct().ToList();
                var origin = nodes.MinBy(id => Spatial.Point(world.NetworkNodes[id].Position).Distance(geometry));
                var targetGeometry = Composition.Geometry(world, world.Features[request.TargetFeatureId!.Value]);
                var destination = nodes.MinBy(id => Spatial.Point(world.NetworkNodes[id].Position).Distance(targetGeometry));
                var adjacency = nodes.ToDictionary(id => id, _ => new List<(Guid To, NetworkReach Reach, bool Reverse)>());
                foreach (var reach in reaches)
                {
                    adjacency[reach.Start].Add((reach.End, reach, false));
                    if (request.NetworkKind != "river") adjacency[reach.End].Add((reach.Start, reach, true));
                }
                var cost = nodes.ToDictionary(id => id, _ => double.PositiveInfinity); cost[origin] = 0;
                var previous = new Dictionary<Guid, (Guid From, NetworkReach Reach, bool Reverse)>(); var queue = new PriorityQueue<Guid, double>(); queue.Enqueue(origin, 0);
                while (queue.TryDequeue(out var node, out var priority))
                {
                    if (priority != cost[node]) continue; if (node == destination) break;
                    foreach (var edge in adjacency[node])
                    {
                        var distance = cost[node] + Spatial.Read(edge.Reach.Geometry).Length;
                        if (distance >= cost[edge.To]) continue;
                        cost[edge.To] = distance; previous[edge.To] = (node, edge.Reach, edge.Reverse); queue.Enqueue(edge.To, distance);
                    }
                }
                Guard.Require(double.IsFinite(cost[destination]), "network_path", "No passable network route joins these locations.");
                var lines = new List<Geometry>();
                for (var node = destination; node != origin; node = previous[node].From)
                {
                    var step = previous[node]; path.Add(node); ids.Add(step.Reach.FeatureId);
                    lines.Add(step.Reverse ? Spatial.Read(step.Reach.Geometry).Reverse() : Spatial.Read(step.Reach.Geometry));
                }
                path.Add(origin); path.Reverse(); lines.Reverse(); ids = ids.Distinct().ToList();
                geometry = lines.Count > 0 ? UnaryUnionOp.Union(lines) : Spatial.Point(world.NetworkNodes[origin].Position);
                measurements["length_m"] = cost[destination]; break;
            case "circulation":
                var rooms = world.Features.Values.Where(f => f.Kind is "room" or "chamber" && Composition.Visible(world, f, area!.Id) && Composition.Geometry(world, f).Intersects(Spatial.Read(area.Footprint))).ToList();
                Guard.Require(selected is not null && rooms.Any(r => r.Id == selected.Id), "circulation_room", "Select a room or chamber in the current space.");
                var connected = rooms.ToDictionary(r => r.Id, _ => new HashSet<Guid>());
                foreach (var passage in world.Features.Values.Where(f => f.Kind is "door" or "stairs" or "cave" && Composition.Visible(world, f, area!.Id) && f.Attributes["passable"]?.GetValue<bool>() != false))
                {
                    var touching = rooms.Where(room => passage.Relations.Any(r => r.TargetId == room.Id && r.Kind == "connects") || Composition.Geometry(world, passage).Intersects(Composition.Geometry(world, room))).Select(r => r.Id).ToList();
                    foreach (var a in touching) foreach (var b in touching.Where(b => b != a)) connected[a].Add(b);
                }
                var seen = new HashSet<Guid> { selected!.Id }; var pending = new Queue<Guid>(); pending.Enqueue(selected.Id);
                while (pending.TryDequeue(out var room)) foreach (var next in connected[room]) if (seen.Add(next)) pending.Enqueue(next);
                ids.AddRange(seen); geometry = UnaryUnionOp.Union(rooms.Where(r => seen.Contains(r.Id)).Select(r => Composition.Geometry(world, r)).ToList());
                measurements["reachable_rooms"] = seen.Count; measurements["unreachable_rooms"] = rooms.Count - seen.Count;
                notes.Add("Reachability uses passable doors and passages in the current located space."); break;
            default: throw new DomainException("analysis_operation", "Choose measure, buffer, intersect, nearby, fieldStatistics, dependencies, networkPath or circulation.");
        }
        return new(geometry.IsEmpty ? null : Spatial.Write(geometry), measurements, ids, areas, path, notes, world.Version);
    }
}
