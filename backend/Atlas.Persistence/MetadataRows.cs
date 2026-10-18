using Atlas.Domain;
using Npgsql;
using static Atlas.Persistence.Sql;

namespace Atlas.Persistence;

public sealed partial class Store
{
    private static async Task WriteNetworks(NpgsqlConnection c, World? before, World w)
    {
        await Revisions(c, "atlas_connections", w.Id, w.Version, before?.Connections, w.Connections, (r, v) => Insert(c, "atlas_connections", Revision(r, w.Id, v.Id, w.Version,
            ("kind", v.Kind), ("a_area", v.A.AreaId), ("a_point", v.A.Position), ("a_feature", Uuid(v.A.FeatureId)),
            ("b_area", v.B.AreaId), ("b_point", v.B.Position), ("b_feature", Uuid(v.B.FeatureId)), ("flow", v.Flow))));
        await Revisions(c, "atlas_nodes", w.Id, w.Version, before?.NetworkNodes, w.NetworkNodes, (r, v) => Insert(c, "atlas_nodes", Revision(r, w.Id, v.Id, w.Version,
            ("kind", v.Kind), ("point", v.Position), ("space_id", Uuid(v.SpaceId)), ("water_level", Number(v.WaterLevel)))));
        await Revisions(c, "atlas_reaches", w.Id, w.Version, before?.NetworkReaches, w.NetworkReaches, (r, v) => Insert(c, "atlas_reaches", Revision(r, w.Id, v.Id, w.Version,
            ("feature_id", v.FeatureId), ("start_id", v.Start), ("end_id", v.End), ("geometry", Spatial.Read(v.Geometry)), ("flow", v.Flow), ("end_flow", Number(v.EndFlow)))));
        await Revisions(c, "atlas_water_transfers", w.Id, w.Version, before?.WaterTransfers, w.WaterTransfers, async (r, list) =>
        {
            var id = w.WaterTransfers.Single(v => ReferenceEquals(v.Value, list)).Key;
            await Insert(c, "atlas_water_transfers", Revision(r, w.Id, id, w.Version));
            for (var i = 0; i < list.Count; i++) await Insert(c, "atlas_water_transfer_items", [("revision_id", r), ("ordinal", i), ("feature_id", list[i].FeatureId),
                ("point", list[i].Position), ("rate", list[i].Rate), ("storage_id", list[i].StorageId), ("field_id", list[i].FieldId)]);
        });
    }

    private sealed record Positioned<T>(int Index, T Value);
    private static Dictionary<Guid, Positioned<T>> Ordered<T>(List<T>? list, Func<T, Guid> id) =>
        (list ?? []).Select((value, index) => new Positioned<T>(index, value)).ToDictionary(v => id(v.Value));

    private static async Task WriteMetadata(NpgsqlConnection c, World? before, World w)
    {
        await Revisions(c, "atlas_magic", w.Id, w.Version, before is null ? null : Ordered(before.Magic, m => m.Id), Ordered(w.Magic, m => m.Id), (r, item) =>
        {
            var v = item.Value;
            return Insert(c, "atlas_magic", Revision(r, w.Id, v.Id, w.Version, ("ordinal", item.Index), ("name", v.Name), ("source", v.Source), ("radius", v.Radius), ("strength", v.Strength),
                ("propagation", v.Propagation), ("effect", v.Effect), ("decay", v.Decay), ("storage", v.Storage), ("depends_on", Null(v.DependsOn?.ToArray(), "uuid[]")),
                ("scope", Null(v.Scope is null ? null : Spatial.Read(v.Scope), "geometry")), ("starts_at_epoch", v.StartsAtEpoch)));
        });
        await Revisions(c, "atlas_views", w.Id, w.Version, before is null ? null : Ordered(before.Views, v => v.Id), Ordered(w.Views, v => v.Id), async (r, item) =>
        {
            var v = item.Value;
            await Insert(c, "atlas_views", Revision(r, w.Id, v.Id, w.Version, ("ordinal", item.Index), ("name", v.Name), ("area_id", v.AreaId)));
            for (var i = 0; i < v.Layers.Count; i++)
            {
                var l = v.Layers[i];
                await Insert(c, "atlas_view_layers", [("revision_id", r), ("ordinal", i), ("layer_id", l.LayerId), ("visible", l.Visible), ("opacity", l.Opacity),
                    ("color", l.Color), ("min_scale", l.MinScale), ("labels", l.Labels), ("filter", Text(l.Filter))]);
            }
        });
        await Revisions(c, "atlas_field_references", w.Id, w.Version, before is null ? null : Ordered(before.Fields, f => f.Id), Ordered(w.Fields, f => f.Id), (r, item) =>
        {
            var v = item.Value;
            return Insert(c, "atlas_field_references", Revision(r, w.Id, v.Id, w.Version, ("ordinal", item.Index), ("area_id", v.AreaId), ("layer_id", v.LayerId),
                ("algorithm", v.Algorithm), ("job_id", v.JobId), ("samples", v.Samples), ("channels", Null(v.Channels?.ToArray(), "text[]"))));
        });
        await Revisions(c, "atlas_generations", w.Id, w.Version, before is null ? null : Ordered(before.Generations, g => g.Id), Ordered(w.Generations, g => g.Id), (r, item) =>
        {
            var v = item.Value;
            return Insert(c, "atlas_generations", Revision(r, w.Id, v.Id, w.Version, ("ordinal", item.Index), ("area_id", v.AreaId), ("seed", v.Seed), ("algorithm", v.Algorithm),
                ("quality", v.Quality), ("domains", v.Domains.ToArray()), ("boundary_version", v.BoundaryVersion), ("epochs", v.Epochs.ToArray()),
                ("completed_at", v.CompletedAt.ToUniversalTime()), ("warnings", v.Warnings.ToArray())));
        });
    }
}
