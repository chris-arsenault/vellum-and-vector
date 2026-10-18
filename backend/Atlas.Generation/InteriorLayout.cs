using Atlas.Domain;
using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Union;
using System.Text.Json.Nodes;
using Position = Atlas.Domain.Position;

namespace Atlas.Generation;

public static class InteriorLayout
{
    public static List<Feature> Generate(GenerationInput input, Guid jobId)
    {
        var world = input.World; var area = world.Areas[input.Request.AreaId]; var shape = Spatial.Read(area.Footprint);
        var random = new Random(input.Request.Seed); var rooms = new List<Feature>(); var result = new List<Feature>();
        var protectedRooms = world.Features.Values.Where(f => f.AreaId == area.Id && f.Kind == "room" && (f.Protected || f.State == Materialization.Authored)).Select(AtlasJson.Clone).ToList();
        rooms.AddRange(protectedRooms);
        var available = protectedRooms.Count > 0 ? shape.Difference(UnaryUnionOp.Union(protectedRooms.Select(f => Spatial.Read(f.Geometry)).ToList())) : shape;
        foreach (var polygon in Composition.Parts(available).Where(p => p.Area > 0)) Split(polygon, $"component-{rooms.Count}");
        Guard.Require(rooms.Count > 0, "interior_layout", "The footprint must contain usable interior space.");
        var access = world.Connections.Values.SelectMany(c => new[] { c.A, c.B }).FirstOrDefault(e => e.AreaId == area.Id && e.FeatureId is not null);
        var entrance = access?.FeatureId is { } accessId ? world.Features.GetValueOrDefault(accessId) : world.Features.Values.FirstOrDefault(f => f.AreaId == area.Id && f.Kind == "entrance");
        var entryPoint = access is not null ? new Coordinate(access.Position.X, access.Position.Y) : entrance is null ? shape.Boundary.Coordinate : Spatial.Read(entrance.Geometry).Coordinate;
        var first = Enumerable.Range(0, rooms.Count).MinBy(i => Spatial.Read(rooms[i].Geometry).Distance(new Point(entryPoint)));
        var links = new List<(int A, int B, Geometry Shared)>();
        for (var a = 0; a < rooms.Count; a++)
            for (var b = a + 1; b < rooms.Count; b++)
            {
                var shared = Spatial.Read(rooms[a].Geometry).Boundary.Intersection(Spatial.Read(rooms[b].Geometry).Boundary);
                if (shared.Length >= .6) links.Add((a, b, shared));
            }
        var connected = new HashSet<int> { first };
        var openings = world.Features.Values.Where(f => f.AreaId == area.Id && f.Kind == "door" && (f.Protected || f.State == Materialization.Authored)).Select(f =>
        {
            var geometry = Spatial.Read(f.Geometry); return geometry.Dimension == Dimension.Point ? geometry.Buffer(.5) : geometry;
        }).ToList();
        while (connected.Count < rooms.Count)
        {
            var frontier = links.Where(l => connected.Contains(l.A) != connected.Contains(l.B)).OrderByDescending(l => l.Shared.Length).ToList();
            Guard.Require(frontier.Count > 0, "interior_access", "Disconnected interior components need their own located entrance or vertical connection.");
            var edge = frontier[0]; var line = Composition.Parts(edge.Shared).OfType<LineString>().MaxBy(l => l.Length)!;
            var index = new NetTopologySuite.LinearReferencing.LengthIndexedLine(line);
            var width = Math.Min(1, line.Length * .6);
            var geometry = index.ExtractLine((line.Length - width) / 2, (line.Length + width) / 2);
            Door(geometry, $"{Math.Min(edge.A, edge.B)}:{Math.Max(edge.A, edge.B)}", [new(rooms[edge.A].Id, "connects"), new(rooms[edge.B].Id, "connects")]);
            connected.Add(edge.A); connected.Add(edge.B);
        }
        var outside = Spatial.Read(rooms[first].Geometry).Boundary.Intersection(Spatial.Factory.CreatePoint(entryPoint).Buffer(.5));
        if (outside.IsEmpty && entrance is not null)
            result.Add(HumanGeography.Generated(world, area, jobId, "Vertical access", "stairs", "structures", entrance.Geometry,
                $"{area.Id}:vertical-access", Attributes(), [new(rooms[first].Id, "connects"), new(entrance.Id, "access")]));
        else Door(outside, "entry", entrance is null ? [new(rooms[first].Id, "connects")] : [new(rooms[first].Id, "connects"), new(entrance.Id, "access")]);
        var walls = UnaryUnionOp.Union(rooms.Select(r => Spatial.Read(r.Geometry).Boundary).ToList());
        if (openings.Count > 0) walls = walls.Difference(UnaryUnionOp.Union(openings.Select(o => o.Buffer(.02)).ToList()));
        foreach (var (wall, i) in Composition.Parts(walls).OfType<LineString>().Select((wall, i) => (wall, i)))
            result.Add(HumanGeography.Generated(world, area, jobId, "Wall", "wall", "structures", Spatial.Write(wall), $"{area.Id}:wall:{i}", Attributes()));
        var parent = area.ContextFeatureId is { } id ? world.Features.GetValueOrDefault(id) : null;
        foreach (var (room, i) in rooms.Select((r, i) => (r, i)))
        {
            if (room.State == Materialization.Generated)
            {
                room.Attributes = Attributes(); room.Attributes["use"] = i == first ? "common" : i == (first + 1) % rooms.Count ? "kitchen" : Spatial.Read(room.Geometry).Area < 16 ? "storage" : "bedroom";
                room.Attributes["history"] = parent?.Attributes["history"]?.DeepClone() ?? new JsonArray(new JsonObject { ["era"] = world.HumanEras[^1].Id, ["action"] = "construction" });
            }
            var geometry = Spatial.Read(room.Geometry); var p = geometry.InteriorPoint;
            var furniture = Spatial.Read(Spatial.Rectangle(p.X - .6, p.Y - .35, 1.2, .7));
            if (geometry.Covers(furniture) && parent?.Attributes["condition"]?.GetValue<string>() is not ("abandoned" or "ruined")) result.Add(HumanGeography.Generated(world, area, jobId, i == first ? "Table" : "Furnishing", "furniture", "structures", Spatial.Write(furniture),
                $"{area.Id}:furniture:{i}", Attributes(), [new(room.Id, "inside")]));
            if (parent?.Attributes["condition"]?.GetValue<string>() == "ruined" && geometry.EnvelopeInternal.MinY <= shape.EnvelopeInternal.Centre.Y)
            {
                var debris = geometry.Intersection(Spatial.Point(new(p.X, p.Y)).Buffer(Math.Sqrt(geometry.Area) / 4));
                result.Add(HumanGeography.Generated(world, area, jobId, "Collapsed material", "rubble", "structures", Spatial.Write(debris), $"{area.Id}:collapse:{i}", Attributes(), [new(room.Id, "blocks")]));
                foreach (var door in result.Where(f => f.Kind == "door" && Spatial.Read(f.Geometry).Intersects(debris))) door.Attributes["passable"] = false;
            }
        }
        result.AddRange(rooms); return result;

        void Split(Geometry polygon, string path)
        {
            var box = polygon.EnvelopeInternal;
            if (polygon.Area <= 36 || Math.Min(box.Width, box.Height) < 4)
            {
                rooms.Add(HumanGeography.Generated(world, area, jobId, $"Room {rooms.Count + 1}", "room", "structures", Spatial.Write(polygon), $"{area.Id}:room:{path}")); return;
            }
            var vertical = box.Width > box.Height; var fraction = .4 + random.NextDouble() * .2;
            var cut = vertical ? Spatial.Read(Spatial.Rectangle(box.MinX - 1, box.MinY - 1, box.Width * fraction + 1, box.Height + 2)) :
                Spatial.Read(Spatial.Rectangle(box.MinX - 1, box.MinY - 1, box.Width + 2, box.Height * fraction + 1));
            var parts = new[] { polygon.Intersection(cut), polygon.Difference(cut) }.SelectMany(Composition.Parts).Where(p => p.Area > 0).ToList();
            for (var i = 0; i < parts.Count; i++) Split(parts[i], $"{path}-{i}");
        }
        JsonObject Attributes() => new() { ["floor"] = area.Frame.Floor, ["elevation"] = area.Frame.Origin.Z };
        void Door(Geometry geometry, string key, List<Relation> relations)
        {
            if (geometry.IsEmpty || geometry.Length <= 0) return;
            openings.Add(geometry);
            var attributes = Attributes(); attributes["passable"] = true;
            result.Add(HumanGeography.Generated(world, area, jobId, key == "entry" ? "Entrance door" : "Door", "door", "structures", Spatial.Write(geometry), $"{area.Id}:door:{key}", attributes, relations));
        }
    }
}
