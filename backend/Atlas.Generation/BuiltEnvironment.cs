using Atlas.Domain;
using NetTopologySuite.Operation.Distance;

namespace Atlas.Generation;

public static class BuiltEnvironment
{
    public static BuiltOutput Generate(GenerationInput input, Guid jobId, FieldData? physical)
    {
        var area = input.World.Areas[input.Request.AreaId];
        var features = area.Context == "cave" ? CaveGeneration.Generate(input, jobId, physical) : area.Profile switch
        {
            Profile.Interior => InteriorLayout.Generate(input, jobId),
            Profile.Site => SiteLayout.Generate(input, jobId, physical),
            _ => Settlements(input, jobId, physical)
        };
        return new(features, [], []);
    }

    private static List<Feature> Settlements(GenerationInput input, Guid jobId, FieldData? physical)
    {
        var world = input.World; var area = world.Areas[input.Request.AreaId]; var shape = Spatial.Read(area.Footprint);
        var communities = world.Features.Values.Where(f => f.Kind == "community" && Composition.Visible(world, f, area.Id) && Composition.Geometry(world, f).Intersects(shape))
            .Select(f => (Point: Spatial.Read(f.Geometry).InteriorPoint.Coordinate, Id: f.Id)).ToList();
        var result = communities.Select((c, i) => HumanGeography.Generated(world, area, jobId, $"Settlement {i + 1}", "settlement", "settlements",
            Spatial.Write(Spatial.Point(new(c.Point.X, c.Point.Y))), $"settlement:{c.Id}", relations: [new(c.Id, "community")])).ToList();
        if (result.Count == 0)
        {
            var bounds = Spatial.Bounds(area.Footprint); var candidates = new List<(Position Point, double Score)>();
            for (var y = 1; y < 12; y++)
                for (var x = 1; x < 12; x++)
                {
                    var point = new Position(bounds[0] + (bounds[2] - bounds[0]) * x / 12, bounds[1] + (bounds[3] - bounds[1]) * y / 12);
                    if (!shape.Covers(Spatial.Point(point)) || physical?.Sample("elevation", point) < 0 || physical?.Sample("water", point) > 0) continue;
                    candidates.Add((point, (physical?.Sample("moisture", point) ?? 200) + Math.Log(1 + (physical?.Sample("flow", point) ?? 0)) * 20 - Math.Abs(physical?.Sample("elevation", point) ?? 0) * .1));
                }
            var selected = new List<Position>(); var spacing = Math.Sqrt(shape.Area) / 4;
            foreach (var candidate in candidates.OrderByDescending(c => c.Score))
                if (selected.All(p => Spatial.Point(p).Distance(Spatial.Point(candidate.Point)) > spacing)) selected.Add(candidate.Point);
            result.AddRange(selected.Select((p, i) => HumanGeography.Generated(world, area, jobId, $"Settlement {i + 1}", "settlement", "settlements", Spatial.Write(Spatial.Point(p)), $"{area.Id}:settlement:{i}")));
        }
        var settlements = result.ToList(); var connected = new HashSet<Guid>();
        if (settlements.Count > 0) connected.Add(settlements[0].Id);
        while (connected.Count < settlements.Count)
        {
            var edge = (from a in settlements
                        where connected.Contains(a.Id)
                        from b in settlements
                        where !connected.Contains(b.Id)
                        orderby Spatial.Read(a.Geometry).Distance(Spatial.Read(b.Geometry))
                        select (A: a, B: b)).First();
            connected.Add(edge.B.Id);
            var start = Spatial.Read(edge.A.Geometry).Coordinate; var end = Spatial.Read(edge.B.Geometry).Coordinate;
            var path = physical is null ? new List<Position> { new(start.X, start.Y), new(end.X, end.Y) } : TerrainRoute.Find(physical, area, new(start.X, start.Y), new(end.X, end.Y));
            if (path.Count < 2 || !shape.Covers(Spatial.Read(Spatial.Line(path)))) continue;
            var route = HumanGeography.Generated(world, area, jobId, "Settlement route", "road", "roads", Spatial.Line(path), $"{area.Id}:route:{edge.A.Id}:{edge.B.Id}", relations: [new(edge.A.Id, "connects"), new(edge.B.Id, "connects")]);
            result.Add(route);
            foreach (var river in world.Features.Values.Where(f => f.Kind == "river" && Composition.Visible(world, f, area.Id)))
                foreach (var coordinate in Spatial.Read(route.Geometry).Intersection(Composition.Geometry(world, river)).Coordinates.Distinct())
                    result.Add(HumanGeography.Generated(world, area, jobId, "River crossing", "bridge", "roads", Spatial.Write(Spatial.Point(new(coordinate.X, coordinate.Y))),
                        $"bridge:{route.Id}:{river.Id}:{coordinate.X:R}:{coordinate.Y:R}", relations: [new(route.Id, "carries"), new(river.Id, "crosses")]));
        }
        foreach (var settlement in settlements)
        {
            var point = Spatial.Read(settlement.Geometry);
            var coast = world.Features.Values.Where(f => f.Kind == "ocean").Select(f => Composition.Geometry(world, f).Boundary).Where(g => g.Distance(point) < Math.Sqrt(shape.Area) / 20).FirstOrDefault();
            if (coast is null) continue;
            var p = DistanceOp.NearestPoints(coast, point)[0];
            result.Add(HumanGeography.Generated(world, area, jobId, "Port", "port", "settlements", Spatial.Write(Spatial.Point(new(p.X, p.Y))), $"port:{settlement.Id}", relations: [new(settlement.Id, "serves")]));
        }
        return result;
    }
}
