using NetTopologySuite.Operation.Distance;
using System.Text.Json.Nodes;

namespace Atlas.Domain;

public sealed record RouteNetwork(Guid AreaId, string Kind, string Name, List<Position> Waypoints,
    Guid? FeatureId = null, Guid? StartFeatureId = null, Guid? EndFeatureId = null, double Flow = 1, Guid? LiftCause = null);

public static class NetworkAuthoring
{
    public static EditFeature Route(World world, RouteNetwork request, IReadOnlyList<FieldData> fields)
    {
        Guard.Require(world.Areas.TryGetValue(request.AreaId, out var area) && request.Kind is "road" or "river" or "cave" && request.Waypoints.Count >= 2 &&
            double.IsFinite(request.Flow) && request.Flow >= 0, "network_route", "A route needs an area, supported network kind, at least two waypoints and nonnegative discharge.");
        var points = request.Waypoints.ToList(); var relations = new List<Relation>();
        if (request.StartFeatureId is { } start) points[0] = Attach(start, points[0]);
        if (request.EndFeatureId is { } end) points[^1] = Attach(end, points[^1]);
        var physical = fields.Where(f => f.Values.ContainsKey("elevation") && Composition.Descendant(world, area!.Id, f.AreaId)).OrderBy(f => world.Areas[f.AreaId].Profile).LastOrDefault();
        if (physical is not null && physical.AreaId != area!.Id) physical = FieldComposition.Resample(physical, area, 96);
        var path = new List<Position>();
        for (var i = 1; i < points.Count; i++)
        {
            var part = physical is null ? new List<Position> { points[i - 1], points[i] } : TerrainRoute.Find(physical, area!, points[i - 1], points[i],
                request.Kind == "cave" ? (a, b) => Spatial.Point(a).Distance(Spatial.Point(b)) * (1 + physical.Sample("rock", b) / 1000) /
                    (.05 + physical.Sample("fracture", b) / 1000 + physical.Sample("carbonate", b)) : null);
            Guard.Require(part.Count >= 2, "network_route", "No contained route connects these waypoints through the available terrain.");
            path.AddRange(part.Skip(i == 1 ? 0 : 1));
        }
        var feature = request.FeatureId is { } id && world.Features.TryGetValue(id, out var old) ? Composition.ForArea(world, old, area!.Id)! :
            new Feature { Id = request.FeatureId ?? Guid.NewGuid(), Name = request.Name, Kind = request.Kind, LayerId = request.Kind == "river" ? "rivers" : "roads", AreaId = area!.Id, Geometry = Spatial.Line(path) };
        feature = AtlasJson.Clone(feature); feature.Name = request.Name; feature.Geometry = Spatial.Line(path);
        if (request.FeatureId is { } existingId && world.Features.TryGetValue(existingId, out var previous))
        {
            var before = Composition.ForArea(world, previous, area!.Id)!;
            if (before.Attributes["elevations"] is not null) feature.Attributes["elevations"] = new JsonArray(path.Select(p => (JsonNode?)JsonValue.Create(Hydrology.ElevationAt(before.Geometry, before.Attributes, p) ?? p.Z)).ToArray());
            if (before.Attributes["discharges"] is not null) feature.Attributes["discharges"] = new JsonArray(path.Select(p => (JsonNode?)JsonValue.Create(Hydrology.DischargeAt(before.Geometry, before.Attributes, p))).ToArray());
            feature.Attributes.Remove("junctionInflows");
        }
        feature.Relations = feature.Relations.Concat(relations).Distinct().ToList();
        if (request.Kind == "river") { feature.Attributes["flow"] = request.Flow; if (request.LiftCause is { } cause) feature.Attributes["liftCause"] = cause.ToString(); }
        return new(area!.Id, feature);

        Position Attach(Guid id, Position point)
        {
            Guard.Require(world.Features.TryGetValue(id, out var target) && Composition.Visible(world, target, request.AreaId), "network_attachment", "Choose an existing network feature in the current space.");
            var geometry = Composition.Geometry(world, target!); var coordinate = DistanceOp.NearestPoints(geometry, Spatial.Point(point))[0];
            relations.Add(new(id, "joins")); return point with { X = coordinate.X, Y = coordinate.Y };
        }
    }
}
