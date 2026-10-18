using Atlas.Domain;
using NetTopologySuite.Geometries;
using NetTopologySuite.LinearReferencing;
using System.Text.Json.Nodes;
using Position = Atlas.Domain.Position;

namespace Atlas.Generation;

public static class RegionalWaterways
{
    public static void Prepare(RegionalGrid grid, Guid jobId)
    {
        var world = grid.Input.World;
        var area = grid.Area;
        if (world.NetworkReaches.Count == 0) Topology.Rebuild(world);
        var shape = Spatial.Read(area.Footprint);
        var blockers = world.Features.Values.Where(f => f.Kind == "river" && Composition.Visible(world, f, area.Id))
            .Select(f => (f.Id, Local: Composition.ForArea(world, f, area.Id)))
            .Where(f => f.Local is not null).ToDictionary(f => f.Id, f => Spatial.Read(f.Local!.Geometry));
        foreach (var source in world.Features.Values.Where(f => f.Kind == "river" && Composition.Visible(world, f, area.Id)))
        {
            var resolved = Composition.ForArea(world, source, area.Id);
            if (resolved is null) continue;
            var parts = new List<LineString>();
            var heights = new List<double>();
            foreach (var line in Composition.Parts(Spatial.Read(resolved.Geometry)).OfType<LineString>())
            {
                var linear = new LengthIndexedLine(line);
                var anchors = new SortedSet<double> { 0, line.Length };
                foreach (var node in world.NetworkNodes.Values.Where(n => n.Kind == "river" && line.Distance(Spatial.Point(n.Position)) < 1e-5)) anchors.Add(linear.Project(new(node.Position.X, node.Position.Y)));
                foreach (var connection in world.Connections.Values.SelectMany(c => new[] { c.A, c.B }).Where(e => e.FeatureId == source.Id)) anchors.Add(linear.Project(new(connection.Position.X, connection.Position.Y)));
                var values = anchors.ToList();
                var coordinates = new List<Coordinate>();
                for (var i = 1; i < values.Count; i++)
                {
                    var a = linear.ExtractPoint(values[i - 1]); var b = linear.ExtractPoint(values[i]);
                    var start = new Position(a.X, a.Y); var end = new Position(b.X, b.Y);
                    var head = Hydrology.ElevationAt(resolved.Geometry, resolved.Attributes, start) ?? grid.Field.Sample("elevation", start);
                    var tail = Hydrology.ElevationAt(resolved.Geometry, resolved.Attributes, end) ?? grid.Field.Sample("elevation", end);
                    var route = resolved.Protected || resolved.State is Materialization.Authored or Materialization.Protected || source.AreaId == area.Id
                        ? Composition.Parts(linear.ExtractLine(values[i - 1], values[i])).OfType<LineString>().SelectMany(l => l.Coordinates.Select(c => new Position(c.X, c.Y))).ToList()
                        : ChannelAlignment.Refine(grid, (LineString)linear.ExtractLine(values[i - 1], values[i]), head, tail,
                            blockers.Where(p => p.Key != source.Id).Select(p => p.Value).ToList());
                    Guard.Require(route.Count >= 2, "river_route_conflict", "No contained waterway route connects the inherited interfaces. Reconcile the extent or authored terrain.");
                    Guard.Require(head >= tail - 1e-5 || resolved.Attributes["liftCause"] is not null, "inherited_flow_conflict", "Inherited water levels require an explained lift or boundary reconciliation.");
                    var routed = new LineString(route.Select(p => new Coordinate(p.X, p.Y)).ToArray());
                    var routeIndex = new LengthIndexedLine(routed);
                    heights.AddRange(route.Skip(i == 1 ? 0 : 1).Select(p => head + (tail - head) * routeIndex.Project(new(p.X, p.Y)) / routed.Length));
                    coordinates.AddRange(route.Skip(i == 1 ? 0 : 1).Select(p => new Coordinate(p.X, p.Y)));
                }
                parts.Add(new LineString(coordinates.ToArray()));
            }
            if (parts.Count == 0) continue;
            resolved.Geometry = Spatial.Write(parts.Count == 1 ? parts[0] : new MultiLineString(parts.ToArray()));
            resolved.Attributes["elevations"] = new JsonArray(heights.Select(h => (JsonNode?)JsonValue.Create(h)).ToArray());
            Refinement.ValidateRiver(resolved, resolved.Geometry);
            resolved.AreaId = area.Id; resolved.Detail = []; resolved.GenerationId = jobId;
            grid.Waterways.Add(resolved);
            grid.WaterwayReference[source.Id] = AtlasJson.Clone(resolved);
            blockers[source.Id] = Spatial.Read(resolved.Geometry);
            foreach (var line in Composition.Parts(Spatial.Read(resolved.Geometry)).OfType<LineString>())
            {
                var indexed = new LengthIndexedLine(line);
                var envelope = line.EnvelopeInternal;
                var low = grid.Index(new(envelope.MinX - grid.Dx / 2, envelope.MinY - grid.Dy / 2));
                var high = grid.Index(new(envelope.MaxX + grid.Dx / 2, envelope.MaxY + grid.Dy / 2));
                for (var y = low / grid.Field.Width; y <= high / grid.Field.Width; y++)
                    for (var x = low % grid.Field.Width; x <= high % grid.Field.Width; x++)
                    {
                        var index = y * grid.Field.Width + x;
                        if (!grid.Interior[index]) continue;
                        var center = grid.Position(index);
                        var cell = Spatial.Read(Spatial.Rectangle(center.X - grid.Dx / 2, center.Y - grid.Dy / 2, grid.Dx, grid.Dy));
                        if (!line.Intersects(cell)) continue;
                        var c = indexed.ExtractPoint(indexed.Project(new(center.X, center.Y)));
                        var p = new Position(c.X, c.Y);
                        var level = Hydrology.ElevationAt(resolved.Geometry, resolved.Attributes, p) ?? grid.Field.Sample("elevation", p);
                        if (grid.Channels.TryGetValue(index, out var old) && Spatial.Point(old.Point).Distance(Spatial.Point(center)) <= Spatial.Point(p).Distance(Spatial.Point(center))) continue;
                        grid.Channels[index] = (source.Id, p, level);
                    }
            }
        }
        Condition(grid);
    }

    public static void Condition(RegionalGrid grid)
    {
        foreach (var (i, channel) in grid.Channels)
        {
            if (!grid.Mutable[i]) continue;
            var requested = Math.Min(0, channel.Level - grid["elevation"][i]);
            var actual = grid.AvailableChange("elevation", i, requested);
            Guard.Require(actual <= requested + 1e-5, "authored_channel_conflict", "The maintained waterway conflicts with a fixed terrain or elevation constraint.");
            grid["elevation"][i] += actual;
            var loose = Math.Min(grid["sediment"][i], -actual);
            grid["sediment"][i] -= loose;
            grid["bedrock"][i] += actual + loose;
            grid["erosion"][i] -= actual;
            grid.PendingSediment[i] -= actual * grid.Measures[i];
            grid["waterSurface"][i] = channel.Level;
        }
    }

    public static void Intercept(RegionalGrid grid)
    {
        grid.ChannelIntakes.Clear();
        var waterways = grid.Waterways.Select(f => (Feature: f, Geometry: Spatial.Read(f.Geometry))).ToList();
        foreach (var i in grid.Order)
        {
            var target = grid.Receiver[i];
            if (target < 0 || grid.Channels.ContainsKey(i) || grid.Waters.Cells.ContainsKey(i) || !grid.Channels.TryGetValue(target, out var receiving)) continue;
            var start = grid.Position(i);
            var segment = Spatial.Read(Spatial.Line([start, receiving.Point]));
            var hit = waterways.Where(w => w.Geometry.EnvelopeInternal.Intersects(segment.EnvelopeInternal))
                .SelectMany(w => segment.Intersection(w.Geometry).Coordinates.Select(c => (w.Feature, Point: new Position(c.X, c.Y))))
                .Append((Feature: grid.Waterways.Single(f => f.Id == receiving.FeatureId), Point: receiving.Point))
                .OrderBy(h => Spatial.Point(start).Distance(Spatial.Point(h.Point))).First();
            var level = Hydrology.ElevationAt(hit.Feature.Geometry, hit.Feature.Attributes, hit.Point) ?? receiving.Level;
            grid.ChannelIntakes[i] = (hit.Feature.Id, hit.Point, level);
            grid.Receiver[i] = -1;
            grid.Routing[i] = Math.Max(grid.Routing[i], level);
        }
        foreach (var i in grid.Order)
            if (grid.Receiver[i] >= 0) grid.Routing[i] = Math.Max(grid.Routing[i], grid.Routing[grid.Receiver[i]]);
    }

}
