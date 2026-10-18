using Atlas.Domain;
using Npgsql;
using static Atlas.Persistence.Sql;

namespace Atlas.Persistence;

public sealed record FeaturePage(List<Feature> Items, long Version, int Total, int? NextOffset);

public sealed partial class Store
{
    public async Task<FeaturePage> Features(Guid id, string owner, int offset, long? expectedVersion)
    {
        Guard.Require(offset >= 0, "invalid_page", "Feature offsets must be nonnegative.");
        await using var c = await source.OpenConnectionAsync();
        await using var transaction = await c.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
        var version = await OwnedVersion(c, id, owner);
        Guard.Require(expectedVersion is null || version == expectedVersion, "version_conflict", "World changed during feature retrieval; reload its metadata.");
        var ids = await Sql.Read(c, "SELECT id FROM atlas_features WHERE scope_id=$1 AND valid_to IS NULL ORDER BY id OFFSET $2 LIMIT 100", r => r.GetGuid(0), id, offset);
        var features = await ReadFeatures(c, id, version, ids.ToArray());
        await using var count = Command(c, "SELECT count(*)::integer FROM atlas_features WHERE scope_id=$1 AND valid_to IS NULL", id);
        var total = (int)(await count.ExecuteScalarAsync())!;
        return new(ids.Select(key => features[key]).ToList(), version, total, offset + ids.Count < total ? offset + ids.Count : null);
    }

    public async Task<Feature?> Feature(Guid id, string owner, Guid featureId, Guid? areaId)
    {
        await using var c = await source.OpenConnectionAsync();
        await using var transaction = await c.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
        var version = await OwnedVersion(c, id, owner);
        var rows = await ReadFeatures(c, id, version, [featureId]);
        Guard.Require(rows.ContainsKey(featureId), "missing_feature", "Feature not found.");
        var feature = rows[featureId];
        if (areaId is null) return feature;
        var world = await ReadVersion(c, id, version, false);
        Guard.Require(world.Areas.ContainsKey(areaId.Value), "missing_area", "Choose a mapped area.");
        var geometries = await Sql.Read(c, "SELECT geometry FROM atlas_feature_index WHERE world_id=$1 AND feature_id=$2 AND space_id=$3", r => r.GetFieldValue<NetTopologySuite.Geometries.Geometry>(0),
            id, featureId, Composition.Space(world, areaId.Value) ?? id);
        return geometries.Count == 0 ? null : ForArea(world, feature, areaId.Value, geometries[0]);
    }

    private static Feature? ForArea(World world, Feature feature, Guid area, NetTopologySuite.Geometries.Geometry geometry)
    {
        var composed = Spatial.Factory.CreateGeometry(geometry).Intersection(Spatial.Read(world.Areas[area].Footprint));
        var parts = Composition.Parts(composed).Where(g => g.Dimension == Spatial.Read(feature.Geometry).Dimension).ToList();
        if (parts.Count == 0) return null;
        var copy = AtlasJson.Clone(feature);
        copy.Geometry = Spatial.Write(composed.Factory.BuildGeometry(parts));
        copy.Attributes = Composition.Attributes(world, feature, Spatial.Read(copy.Geometry), area);
        if (feature.Detail.TryGetValue(area, out var detail) && !detail.NeedsReconciliation)
        { copy.State = detail.State; copy.Protected = detail.Protected; copy.Actor = detail.Actor; }
        return copy;
    }
}
