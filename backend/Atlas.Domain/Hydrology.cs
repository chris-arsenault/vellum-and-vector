using NetTopologySuite.Geometries;
using NetTopologySuite.LinearReferencing;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Atlas.Domain;

public static class Hydrology
{
    public static (double Minimum, double Maximum) FlowRange(Crossing crossing) =>
        (crossing.FlowMinimum ?? Math.Max(0, crossing.Flow - crossing.FlowUncertainty), crossing.FlowMaximum ?? crossing.Flow + crossing.FlowUncertainty);

    public static double? ElevationAt(JsonObject geometry, JsonObject attributes, Position point) => SeriesAt(geometry, attributes, point, "elevations");

    public static double DischargeAt(JsonObject geometry, JsonObject attributes, Position point, bool arriving = false)
    {
        var value = SeriesAt(geometry, attributes, point, "discharges") ?? attributes["flow"]?.Deserialize<double>() ?? 0;
        if (arriving && attributes["junctionInflows"] is JsonArray inflows)
        {
            var coordinates = Spatial.Read(geometry).Coordinates;
            for (var i = 0; i < coordinates.Length && i < inflows.Count; i++)
                if (coordinates[i].Distance(new(point.X, point.Y)) < 1e-5) return value - inflows[i]!.Deserialize<double>();
        }
        return value;
    }

    public static double? SeriesAt(JsonObject geometry, JsonObject attributes, Position point, string channel)
    {
        if (attributes[channel] is not JsonArray heights || heights.Count < 2) return null;
        var shape = Spatial.Read(geometry);
        var along = new LengthIndexedLine(shape).Project(new Coordinate(point.X, point.Y));
        if (heights.Count != shape.Coordinates.Length)
            return heights[0]!.Deserialize<double>() + (heights[^1]!.Deserialize<double>() - heights[0]!.Deserialize<double>()) * along / shape.Length;
        var offset = 0;
        for (var part = 0; part < shape.NumGeometries; part++)
        {
            var line = shape.GetGeometryN(part);
            var coordinates = line.Coordinates;
            if (line.Distance(Spatial.Point(point)) > 1e-5)
            {
                offset += coordinates.Length;
                continue;
            }
            var distance = 0d;
            var local = new LengthIndexedLine(line).Project(new Coordinate(point.X, point.Y));
            for (var i = 1; i < coordinates.Length; i++)
            {
                var length = coordinates[i - 1].Distance(coordinates[i]);
                if (local <= distance + length && length > 0)
                {
                    var a = heights[offset + i - 1]!.Deserialize<double>();
                    var b = heights[offset + i]!.Deserialize<double>();
                    if (channel == "discharges" && attributes["junctionInflows"] is JsonArray inflows && local < distance + length - 1e-6)
                        b -= inflows[offset + i]!.Deserialize<double>();
                    return a + (b - a) * Math.Clamp((local - distance) / length, 0, 1);
                }
                distance += length;
            }
            offset += coordinates.Length;
        }
        return heights[^1]!.Deserialize<double>();
    }

    public static void Prepare(World world, Area area, Feature candidate, IReadOnlyList<FieldData> fields)
    {
        if (candidate.Kind != "river") return;
        var old = world.Features.GetValueOrDefault(candidate.Id);
        var resolved = old is null ? null : Composition.ForArea(world, old, area.Id);
        var sourceGeometry = resolved?.Geometry ?? candidate.Geometry;
        var sourceAttributes = resolved?.Attributes ?? candidate.Attributes;
        var explicitHeights = candidate.Attributes["elevations"] is JsonArray proposed &&
            proposed.ToJsonString() != sourceAttributes["elevations"]?.ToJsonString() &&
            proposed.ToJsonString() != old?.Attributes["elevations"]?.ToJsonString();
        if (explicitHeights) return;
        var shape = Spatial.Read(candidate.Geometry);
        Guard.Require(shape is LineString or MultiLineString, "river_geometry", "River geometry must be a line or connected line network.");
        var contracts = world.Areas.Values.Where(a => a.Boundary is not null)
            .SelectMany(a => a.Boundary!.Crossings).Where(c => c.FeatureId == candidate.Id).ToList();
        var physical = fields.Where(f => f.Values.ContainsKey("elevation") && IsAncestor(world, f.AreaId, area.Id))
            .OrderBy(f => world.Areas[f.AreaId].Profile).LastOrDefault();
        if (sourceAttributes["elevations"] is null && contracts.Count == 0 && physical is null) return;
        var lines = new List<LineString>();
        var heights = new List<double>();
        for (var part = 0; part < shape.NumGeometries; part++)
        {
            var line = (LineString)shape.GetGeometryN(part);
            var index = new LengthIndexedLine(line);
            var anchors = new SortedDictionary<double, double>
            {
                [0] = Height(line.Coordinates[0]),
                [line.Length] = Height(line.Coordinates[^1])
            };
            foreach (var crossing in contracts.Where(c => line.Distance(Spatial.Point(c.Point)) < 1e-5))
                anchors[index.Project(new(crossing.Point.X, crossing.Point.Y))] = crossing.Elevation;
            var coordinates = line.Coordinates.Select(c => (Distance: index.Project(c), Point: c))
                .Concat(anchors.Keys.Select(d => (Distance: d, Point: index.ExtractPoint(d))))
                .OrderBy(c => c.Distance).DistinctBy(c => Math.Round(c.Distance, 8)).ToList();
            foreach (var coordinate in coordinates)
            {
                var a = anchors.Last(p => p.Key <= coordinate.Distance + 1e-8);
                var b = anchors.First(p => p.Key >= coordinate.Distance - 1e-8);
                heights.Add(b.Key - a.Key < 1e-8 ? a.Value : a.Value + (b.Value - a.Value) * (coordinate.Distance - a.Key) / (b.Key - a.Key));
            }
            lines.Add(new(coordinates.Select(c => c.Point).ToArray()));
        }
        candidate.Geometry = Spatial.Write(lines.Count == 1 ? lines[0] : new MultiLineString(lines.ToArray()));
        candidate.Attributes["elevations"] = new JsonArray(heights.Select(h => (JsonNode?)JsonValue.Create(h)).ToArray());

        double Height(Coordinate c) => ElevationAt(sourceGeometry, sourceAttributes, new(c.X, c.Y)) ?? physical?.Sample("elevation", new(c.X, c.Y)) ?? 0;
    }

    public static void ValidateLift(World world, Feature feature)
    {
        if (feature.Kind != "river" || feature.Attributes["liftCause"] is not { } cause) return;
        var id = Guid.TryParse(cause.GetValue<string>(), out var value) ? value : Guid.Empty;
        var rule = world.Magic.FirstOrDefault(r => r.Id == id && r.Effect == "gravity");
        Guard.Require(rule is not null, "unexplained_lift", "An uphill river needs the ID of a declared gravity source.");
        var extent = rule!.Scope is { } scope ? Spatial.Read(scope) : Spatial.Point(rule.Source).Buffer(rule.Radius);
        Guard.Require(extent.Covers(Spatial.Read(feature.Geometry)), "lift_scope", "The gravity mechanism must cover the lifted river path.");
        foreach (var line in Composition.Parts(Spatial.Read(feature.Geometry)))
            for (var i = 1; i < line.Coordinates.Length; i++)
            {
                var a = new Position(line.Coordinates[i - 1].X, line.Coordinates[i - 1].Y);
                var b = new Position(line.Coordinates[i].X, line.Coordinates[i].Y);
                var head = ElevationAt(feature.Geometry, feature.Attributes, a);
                var tail = ElevationAt(feature.Geometry, feature.Attributes, b);
                Guard.Require(head is not null && tail is not null && head + MagicPhysics.Potential(rule, a) >= tail + MagicPhysics.Potential(rule, b) - 1e-5,
                    "insufficient_lift", "The declared gravity potential does not supply enough head for this uphill reach.");
            }
    }

    public static JsonObject GeometricAttributes(JsonObject attributes) => new(attributes
        .Where(p => p.Key is "elevations" or "discharges" or "junctionInflows" or "flow" or "waterSurface" or "elevation" or "floor" or "waterExchange" or
            "waterLevel" or "storage" or "hypsometry" or "spillElevation" or "outlet" or "outletFrom" or "outletPath" or "suspendedSediment")
        .Select(p => new KeyValuePair<string, JsonNode?>(p.Key, p.Value?.DeepClone())));

    private static bool IsAncestor(World world, Guid ancestor, Guid child)
    {
        for (Guid? id = child; id is { } current; id = world.Areas[current].ParentId)
            if (current == ancestor) return true;
        return false;
    }
}
