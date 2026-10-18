using Atlas.Domain;
using NetTopologySuite.Geometries;
using Npgsql;
using System.Text.Json.Nodes;
using static Atlas.Persistence.Sql;

namespace Atlas.Persistence;

public sealed partial class Store
{
    public async Task<AnalysisResult> Analyze(Guid id, string owner, AnalysisRequest request)
    {
        var world = await Read(id, owner);
        var fields = request.Operation == "fieldStatistics" ? await ReadFields(id, world.Fields.Where(f => f.Channels?.Contains(request.Channel!) != false).Select(f => f.Id)) : [];
        return SpatialAnalysis.Run(world, request, fields);
    }

    internal static async Task Reindex(NpgsqlConnection c, World world, World? before = null, IEnumerable<Guid>? affected = null)
    {
        var spatialContextChanged = before is null || Serialize(world.Areas.Values.Select(a => new { a.Id, a.ParentId, a.Footprint, a.Frame, a.Profile, a.Context })) !=
            Serialize(before.Areas.Values.Select(a => new { a.Id, a.ParentId, a.Footprint, a.Frame, a.Profile, a.Context })) || Serialize(world.Connections) != Serialize(before.Connections);
        var candidates = (spatialContextChanged ? world.Features.Keys.AsEnumerable() : affected ?? world.Features.Keys)
            .Concat(world.Features.Keys.Except(before?.Features.Keys.AsEnumerable() ?? []))
            .Concat((before?.Features.Keys.AsEnumerable() ?? []).Except(world.Features.Keys));
        var changed = candidates.Where(id => spatialContextChanged || before is null || !before.Features.TryGetValue(id, out var old) ||
            !world.Features.TryGetValue(id, out var current) || Serialize(old) != Serialize(current)).ToHashSet();
        var bindings = world.Features.Values.SelectMany(f => f.Relations.Where(r => r.Kind == "follows").Select(r => (Target: r.TargetId, Feature: f.Id)))
            .GroupBy(r => r.Target).ToDictionary(g => g.Key, g => g.Select(r => r.Feature).ToList());
        var pending = new Queue<Guid>(changed);
        while (pending.TryDequeue(out var id)) foreach (var dependent in bindings.GetValueOrDefault(id) ?? []) if (changed.Add(dependent)) pending.Enqueue(dependent);
        if (changed.Count == 0) return;
        await Execute(c, "DELETE FROM atlas_feature_index WHERE world_id=$1 AND feature_id=ANY($2)", world.Id, changed.ToArray());
        foreach (var feature in changed.Where(world.Features.ContainsKey).Select(id => world.Features[id]))
        {
            var geometry = Composition.Geometry(world, feature);
            var spaces = new HashSet<Guid> { Composition.Space(world, feature.AreaId) ?? world.Id };
            if (feature.Kind == "entrance")
                foreach (var connection in world.Connections.Values)
                {
                    if (connection.A.FeatureId == feature.Id) spaces.Add(Composition.Space(world, connection.B.AreaId) ?? world.Id);
                    if (connection.B.FeatureId == feature.Id) spaces.Add(Composition.Space(world, connection.A.AreaId) ?? world.Id);
                }
            foreach (var space in spaces) await Insert(c, "atlas_feature_index", [("world_id", world.Id), ("feature_id", feature.Id),
                ("space_id", space), ("layer_id", feature.LayerId), ("geometry", geometry)]);
        }
    }

    public async Task<List<Feature>> Query(Guid worldId, string owner, JsonObject geometry, Guid areaId, string? layer = null, long? expectedVersion = null)
    {
        await using var c = await source.OpenConnectionAsync();
        await using var transaction = await c.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
        var version = await OwnedVersion(c, worldId, owner);
        Guard.Require(expectedVersion is null || version == expectedVersion, "version_conflict", "World changed during query; reload its metadata.");
        var world = await ReadVersion(c, worldId, version, false);
        Guard.Require(world.Areas.ContainsKey(areaId), "missing_area", "Query area does not exist.");
        var areaShape = Spatial.Read(world.Areas[areaId].Footprint);
        var scope = Spatial.Read(geometry).Intersection(areaShape);
        var matches = await Sql.Read(c,
            "SELECT feature_id,geometry FROM atlas_feature_index WHERE world_id=$1 AND space_id=$2 AND ST_Intersects(geometry,$3) AND ($4::text IS NULL OR layer_id=$4) ORDER BY feature_id",
            r => (Id: r.GetGuid(0), Geometry: r.GetFieldValue<Geometry>(1)), worldId, Composition.Space(world, areaId) ?? worldId, scope, Text(layer));
        var features = await ReadFeatures(c, worldId, version, matches.Select(m => m.Id).ToArray());
        var result = new List<Feature>();
        foreach (var match in matches)
        {
            var copy = ForArea(world, features[match.Id], areaId, match.Geometry);
            if (copy is not null) result.Add(copy);
        }
        return result;
    }
}
