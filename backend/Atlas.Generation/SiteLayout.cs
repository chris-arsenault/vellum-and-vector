using Atlas.Domain;
using NetTopologySuite.Geometries;
using NetTopologySuite.LinearReferencing;
using NetTopologySuite.Operation.Distance;
using NetTopologySuite.Operation.Union;
using NetTopologySuite.Triangulate;
using System.Text.Json.Nodes;
using Position = Atlas.Domain.Position;

namespace Atlas.Generation;

public static class SiteLayout
{
    public static List<Feature> Generate(GenerationInput input, Guid jobId, FieldData? physical)
    {
        var world = input.World; var area = world.Areas[input.Request.AreaId]; var shape = Spatial.Read(area.Footprint);
        var result = new List<Feature>(); var streets = new List<Geometry>();
        foreach (var source in world.Features.Values.Where(f => f.Kind == "road" && Composition.Visible(world, f, area.Id) &&
            (f.AreaId != area.Id || f.Protected || f.State == Materialization.Authored)))
        {
            var clipped = Composition.ForArea(world, source, area.Id);
            if (clipped is null || Spatial.Read(clipped.Geometry).Length <= 0) continue;
            clipped.AreaId = area.Id; clipped.Detail = []; result.Add(clipped); streets.Add(Spatial.Read(clipped.Geometry));
        }
        if (streets.Count == 0)
        {
            var crossings = area.Boundary?.Crossings.Where(c => c.Kind == "road").Select(c => c.Point).ToList() ?? [];
            var box = shape.EnvelopeInternal; var center = shape.InteriorPoint.Coordinate;
            var a = crossings.FirstOrDefault() ?? new Position(box.MinX, center.Y);
            var b = crossings.Skip(1).FirstOrDefault() ?? new Position(box.MaxX, center.Y);
            if (crossings.Count == 0)
            {
                var section = Composition.Parts(shape.Intersection(Spatial.Read(Spatial.Line([a, b])))).OfType<LineString>().MaxBy(l => l.Length);
                Guard.Require(section is not null, "site_access", "Draw an internal street through this site footprint.");
                var indexed = new LengthIndexedLine(section!); var first = indexed.ExtractPoint(section!.Length * .05); var last = indexed.ExtractPoint(section.Length * .95);
                a = new(first.X, first.Y); b = new(last.X, last.Y);
            }
            else { a = InsideBoundary(a); b = InsideBoundary(b); }
            var path = physical is null ? new List<Position> { a, b } : TerrainRoute.Find(physical, area, a, b);
            if (path.Count >= 2 && shape.Covers(Spatial.Read(Spatial.Line(path))))
            {
                var geometry = Spatial.Read(Spatial.Line(path)); streets.Add(geometry);
                result.Add(HumanGeography.Generated(world, area, jobId, "Main access", "road", "roads", Spatial.Write(geometry), $"{area.Id}:main-access"));
            }
        }
        Guard.Require(streets.Count > 0, "site_access", "A settlement site needs a traversable access route or an authored street.");
        var road = UnaryUnionOp.Union(streets); var roadWidth = Math.Clamp(Math.Sqrt(shape.Area) / 25, 1.5, 6);
        var spacing = Math.Max(8, roadWidth * 5); var seeds = new List<Position>();
        foreach (var line in Composition.Parts(road).OfType<LineString>())
        {
            var indexed = new LengthIndexedLine(line);
            for (var distance = spacing / 2; distance < line.Length; distance += spacing)
            {
                var p = indexed.ExtractPoint(distance); var q = indexed.ExtractPoint(Math.Min(line.Length, distance + .1));
                var length = Math.Max(1e-9, p.Distance(q));
                foreach (var side in new[] { -1, 1 })
                {
                    var point = new Position(p.X - (q.Y - p.Y) / length * spacing * .6 * side, p.Y + (q.X - p.X) / length * spacing * .6 * side);
                    if (shape.Contains(Spatial.Point(point)) && (physical is null || physical.Sample("elevation", point) >= 0 && physical.Sample("water", point) == 0)) seeds.Add(point);
                }
            }
        }
        seeds = seeds.DistinctBy(p => Spatial.Quantize(p)).ToList();
        if (seeds.Count == 0) return result;
        var buildable = shape.Difference(road.Buffer(roadWidth));
        var obstacles = world.Features.Values.Where(f => (f.Kind is "lake" or "ocean" || f.Kind == "building" && (f.AreaId != area.Id || f.Protected || f.State == Materialization.Authored)) && Composition.Visible(world, f, area.Id))
            .Select(f => Composition.Geometry(world, f)).Where(g => g.Intersects(shape)).ToList();
        if (obstacles.Count > 0) buildable = buildable.Difference(UnaryUnionOp.Union(obstacles));
        var diagram = new VoronoiDiagramBuilder { ClipEnvelope = shape.EnvelopeInternal };
        diagram.SetSites(seeds.Select(p => new Coordinate(p.X, p.Y)).ToList());
        foreach (var (cell, index) in Composition.Parts(diagram.GetDiagram(Spatial.Factory)).Select((p, i) => (p, i)))
        {
            var parcel = cell.Intersection(buildable);
            if (parcel.Area < 25) continue;
            parcel = Composition.Parts(parcel).Where(p => p.Area > 0).MaxBy(p => p.Area)!;
            var parcelFeature = HumanGeography.Generated(world, area, jobId, $"Parcel {index + 1}", "parcel", "structures", Spatial.Write(parcel), $"{area.Id}:parcel:{index}");
            var inner = parcel.Buffer(-Math.Max(.5, roadWidth * .2));
            if (inner.IsEmpty || inner.Area < 16) continue;
            var center = inner.InteriorPoint; var footprint = inner.Intersection(Spatial.Read(Spatial.Rectangle(center.X - spacing * .25, center.Y - spacing * .3, spacing * .5, spacing * .6)));
            if (footprint.Area < 12) continue;
            var nearest = DistanceOp.NearestPoints(footprint.Boundary, road);
            var door = new Position(nearest[0].X, nearest[0].Y, physical?.Sample("elevation", new(nearest[0].X, nearest[0].Y)) ?? area.Frame.Origin.Z);
            var street = new Position(nearest[1].X, nearest[1].Y, door.Z);
            var access = Spatial.Read(Spatial.Line([door, street]));
            if (!shape.Covers(access)) continue;
            var history = History(door, index);
            var latest = history.OfType<JsonObject>().LastOrDefault(e => e["action"]?.GetValue<string>() is "collapse" or "abandonment" or "rebuilding");
            var condition = latest?["action"]?.GetValue<string>() switch { "collapse" => "ruined", "abandonment" => "abandoned", _ => "occupied" };
            if (history.OfType<JsonObject>().Any(e => e["action"]?.GetValue<string>() is "extension" or "rebuilding"))
                footprint = inner.Intersection(Spatial.Read(Spatial.Rectangle(center.X - spacing * .3, center.Y - spacing * .3, spacing * .6, spacing * .6)));
            if (condition == "ruined")
            {
                var box = footprint.EnvelopeInternal;
                footprint = footprint.Difference(Spatial.Read(Spatial.Rectangle(box.Centre.X, box.MinY, box.Width / 2 + .1, box.Height / 3)));
                if (footprint.IsEmpty || footprint.Area < 4) continue;
            }
            nearest = DistanceOp.NearestPoints(footprint.Boundary, road);
            door = new(nearest[0].X, nearest[0].Y, door.Z); street = new(nearest[1].X, nearest[1].Y, door.Z);
            access = Spatial.Read(Spatial.Line([door, street]));
            if (!shape.Covers(access)) continue;
            var building = HumanGeography.Generated(world, area, jobId, index == 0 ? "Tavern" : $"Building {index + 1}", "building", "structures", Spatial.Write(footprint), $"{area.Id}:building:{index}",
                new() { ["elevation"] = door.Z, ["substrate"] = physical?.Sample("rock", door) ?? 0, ["condition"] = condition, ["use"] = index == 0 ? "tavern" : "dwelling", ["history"] = history }, [new(parcelFeature.Id, "parcel")]);
            var doorFeature = HumanGeography.Generated(world, area, jobId, "Building door", "door", "structures", Spatial.Write(Spatial.Point(door)), $"{area.Id}:building-door:{index}",
                new() { ["elevation"] = door.Z, ["passable"] = true }, [new(building.Id, "entranceTo")]);
            var streetFeature = result.Where(f => f.Kind == "road").MinBy(f => Spatial.Read(f.Geometry).Distance(Spatial.Point(street)))!;
            result.Add(parcelFeature); result.Add(building); result.Add(doorFeature);
            result.Add(HumanGeography.Generated(world, area, jobId, "Building access", "road", "roads", Spatial.Write(access), $"{area.Id}:building-access:{index}", relations: [new(doorFeature.Id, "connects"), new(streetFeature.Id, "joins")]));
        }
        return result;

        Position InsideBoundary(Position point)
        {
            var near = DistanceOp.NearestPoints(shape.Boundary, Spatial.Point(point))[0]; return new(near.X, near.Y);
        }
        JsonArray History(Position point, int index)
        {
            if (world.Features.GetValueOrDefault(Registry.Identity(world.Id, $"{area.Id}:building:{index}"))?.Attributes["history"] is JsonArray saved) return AtlasJson.Clone(saved);
            var entries = new JsonArray(new JsonObject { ["era"] = world.HumanEras[0].Id, ["action"] = "construction", ["cause"] = "settlement-access-and-substrate" });
            var people = input.Fields.Where(f => f.Values.ContainsKey("population") && Registry.IsAncestor(world, f.AreaId, area.Id)).OrderBy(f => world.Areas[f.AreaId].Profile).LastOrDefault();
            var previous = people?.HumanHistory?.FirstOrDefault()?.Surface.Sample("population", point) ?? 0;
            var abandoned = false;
            foreach (var era in world.HumanEras.Skip(1))
            {
                var past = era.PhysicalEpoch is { } id ? physical?.History?.FirstOrDefault(h => h.Epoch.Id == id)?.Surface : null;
                var flood = past?.Values.ContainsKey("waterDepth") == true ? past.Sample("waterDepth", point) : physical?.Sample("waterDepth", point) ?? 0;
                var population = people?.HumanHistory?.FirstOrDefault(h => h.Era.Id == era.Id)?.Surface.Sample("population", point) ?? previous;
                if (flood > .5) { entries.Add(new JsonObject { ["era"] = era.Id, ["action"] = "collapse", ["cause"] = "flood", ["depth"] = flood }); abandoned = true; }
                else if (previous > 0 && population < previous * .6) { entries.Add(new JsonObject { ["era"] = era.Id, ["action"] = "abandonment", ["cause"] = "population-contraction" }); abandoned = true; }
                else if (population > previous * 1.4 && population > 0) { entries.Add(new JsonObject { ["era"] = era.Id, ["action"] = abandoned ? "rebuilding" : "extension", ["cause"] = "population-growth" }); abandoned = false; }
                else entries.Add(new JsonObject { ["era"] = era.Id, ["action"] = "occupation", ["cause"] = "continued-access" });
                previous = population;
            }
            return entries;
        }
    }
}
