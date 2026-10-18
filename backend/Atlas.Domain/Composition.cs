using NetTopologySuite.Geometries;
using System.Text.Json.Nodes;

namespace Atlas.Domain;

public static class Composition
{
    public static bool IsSpace(Area area) => area.Profile == Profile.Interior || area.Context == "cave" || area.Frame.Floor is not null;
    public static Guid? Space(World world, Guid areaId)
    {
        for (Guid? id = areaId; id is { } current; id = world.Areas[current].ParentId)
        {
            var area = world.Areas[current];
            if (IsSpace(area)) return current;
        }
        return null;
    }

    public static bool Visible(World world, Feature feature, Guid areaId)
    {
        var space = Space(world, areaId);
        if (Space(world, feature.AreaId) == space) return true;
        return feature.Kind == "entrance" && world.Connections.Values.Any(c =>
            c.A.FeatureId == feature.Id && Space(world, c.B.AreaId) == space ||
            c.B.FeatureId == feature.Id && Space(world, c.A.AreaId) == space);
    }

    public static bool Descendant(World world, Guid child, Guid ancestor)
    {
        for (Guid? id = child; id is { } current; id = world.Areas[current].ParentId)
            if (current == ancestor) return true;
        return false;
    }

    public static IEnumerable<(Guid Area, Geometry Geometry, JsonObject Attributes)> Patches(World world, Feature feature)
    {
        yield return (feature.AreaId, Spatial.Read(feature.Geometry), feature.Attributes);
        foreach (var (id, detail) in feature.Detail.OrderBy(d => world.Areas[d.Key].Profile).ThenBy(d => d.Key))
        {
            if (detail.NeedsReconciliation || detail.State == Materialization.Stale || Space(world, id) != Space(world, feature.AreaId)) continue;
            yield return (id, Spatial.Read(detail.Geometry), detail.Attributes ?? feature.Attributes);
        }
    }

    public static Geometry Geometry(World world, Feature feature)
    {
        var result = Dependencies.BoundGeometry(world, feature) ?? Spatial.Read(feature.Geometry);
        foreach (var patch in Patches(world, feature).Skip(1))
        {
            var footprint = Spatial.Read(world.Areas[patch.Area].Footprint);
            var pieces = Parts(result.Difference(footprint)).Concat(Parts(patch.Geometry.Intersection(footprint)))
                .Where(g => g.Dimension == result.Dimension).ToList();
            result = result.Factory.BuildGeometry(pieces);
        }
        return result;
    }

    public static Feature? ForArea(World world, Feature feature, Guid areaId)
    {
        if (!Visible(world, feature, areaId)) return null;
        var composed = Geometry(world, feature).Intersection(Spatial.Read(world.Areas[areaId].Footprint));
        var parts = Parts(composed).Where(g => g.Dimension == Spatial.Read(feature.Geometry).Dimension).ToList();
        if (parts.Count == 0) return null;
        var result = AtlasJson.Clone(feature);
        result.Geometry = Spatial.Write(composed.Factory.BuildGeometry(parts));
        result.Attributes = Attributes(world, feature, Spatial.Read(result.Geometry), areaId);
        if (feature.Detail.TryGetValue(areaId, out var detail) && !detail.NeedsReconciliation)
        {
            result.State = detail.State;
            result.Protected = detail.Protected;
            result.Actor = detail.Actor;
        }
        return result;
    }

    public static JsonObject Attributes(World world, Feature feature, Geometry geometry, Guid areaId)
    {
        var result = Refinement.LocalAttributesFor(world, feature, areaId);
        if (feature.Kind == "river")
        {
            var patches = Patches(world, feature).Reverse().ToList();
            var heights = geometry.Coordinates.Select(c =>
            {
                var p = new Position(c.X, c.Y);
                var patch = patches.First(v => v.Geometry.Distance(Spatial.Point(p)) < 1e-5);
                return Hydrology.ElevationAt(Spatial.Write(patch.Geometry), patch.Attributes, p);
            }).ToList();
            if (heights.All(h => h is not null))
                result["elevations"] = new JsonArray(heights.Select(h => (JsonNode?)JsonValue.Create(h!.Value)).ToArray());
            foreach (var channel in new[] { "discharges", "junctionInflows" })
            {
                if (!patches.Any(p => p.Attributes[channel] is JsonArray)) continue;
                var series = geometry.Coordinates.Select(c =>
                {
                    var p = new Position(c.X, c.Y);
                    var patch = patches.First(v => v.Geometry.Distance(Spatial.Point(p)) < 1e-5);
                    return channel == "discharges" ? Hydrology.DischargeAt(Spatial.Write(patch.Geometry), patch.Attributes, p) :
                        VertexValue(patch.Geometry, patch.Attributes, p, channel);
                });
                result[channel] = new JsonArray(series.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
            }
        }
        return result;
    }

    private static double VertexValue(Geometry geometry, JsonObject attributes, Position p, string channel)
    {
        if (attributes[channel] is not JsonArray values) return 0;
        var coordinates = geometry.Coordinates;
        for (var i = 0; i < coordinates.Length && i < values.Count; i++)
            if (coordinates[i].Distance(new(p.X, p.Y)) < 1e-5) return values[i]?.GetValue<double>() ?? 0;
        return 0;
    }

    public static IEnumerable<Geometry> Parts(Geometry geometry)
    {
        if (geometry.IsEmpty) yield break;
        if (geometry is GeometryCollection)
        {
            for (var i = 0; i < geometry.NumGeometries; i++)
                foreach (var part in Parts(geometry.GetGeometryN(i))) yield return part;
        }
        else yield return geometry;
    }
}
