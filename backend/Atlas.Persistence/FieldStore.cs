using Atlas.Domain;
using Npgsql;
using static Atlas.Persistence.Sql;

namespace Atlas.Persistence;

public sealed partial class Store
{
    public async Task<List<FieldData>> ReadFields(Guid world, IEnumerable<Guid> ids)
    {
        await using var c = await source.OpenConnectionAsync();
        await using var transaction = await c.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
        return await ReadFields(c, world, ids);
    }

    internal static async Task WriteFields(NpgsqlConnection c, Guid world, IEnumerable<FieldData> fields)
    {
        foreach (var f in fields)
        {
            f.Validate();
            await using var existing = Command(c, "SELECT world_id FROM atlas_fields WHERE id=$1", f.Id);
            if (await existing.ExecuteScalarAsync() is Guid storedWorld)
            {
                Guard.Require(storedWorld == world, "field_identity", "A field identity belongs to another world.");
                var saved = (await ReadFields(c, world, [f.Id])).Single();
                Guard.Require(System.Text.Json.Nodes.JsonNode.DeepEquals(System.Text.Json.JsonSerializer.SerializeToNode(saved, AtlasJson.Options),
                    System.Text.Json.JsonSerializer.SerializeToNode(f, AtlasJson.Options)), "field_identity", "Immutable field identities cannot be reused with changed values.");
                continue;
            }
            var grid = await WriteGrid(c, world, new(f.Bounds, f.Width, f.Height, f.Values, f.WaterBodies), f.Measures);
            var initial = f.Initial is null ? (Guid?)null : await WriteGrid(c, world, f.Initial);
            await Insert(c, "atlas_fields", [("id", f.Id), ("world_id", world), ("area_id", f.AreaId), ("grid_id", grid), ("algorithm", f.Algorithm), ("seed", f.Seed),
                ("boundary", Null(DbFieldBoundary.From(f.Boundary), "atlas_field_boundary")), ("initial_grid", Uuid(initial)), ("has_authored", f.Authored is not null),
                ("has_history", f.History is not null), ("has_budgets", f.Budgets is not null), ("has_transfers", f.Transfers is not null), ("has_links", f.Links is not null),
                ("has_human_history", f.HumanHistory is not null)]);
            for (var i = 0; i < (f.Authored?.Count ?? 0); i++)
            {
                var p = f.Authored![i]; var samples = p.Samples is null ? (Guid?)null : await WriteGrid(c, world, p.Samples);
                await Insert(c, "atlas_field_protections", [("field_id", f.Id), ("ordinal", i), ("id", p.Id), ("footprint", Spatial.Read(p.Footprint)),
                    ("channels", p.Channels.ToArray()), ("actor", p.Actor), ("grid_id", Uuid(samples))]);
            }
            for (var i = 0; i < (f.History?.Count ?? 0); i++)
            {
                var h = f.History![i]; var snapshot = await WriteGrid(c, world, h.Surface);
                await Insert(c, "atlas_field_epochs", [("field_id", f.Id), ("ordinal", i), ("epoch", h.Epoch), ("grid_id", snapshot), ("forcing", h.Forcing.ToArray()), ("has_links", h.Links is not null)]);
                await WriteLinks(c, f.Id, i, h.Links);
            }
            for (var i = 0; i < (f.Budgets?.Count ?? 0); i++) await Insert(c, "atlas_field_budgets", [("field_id", f.Id), ("ordinal", i), ("budget", f.Budgets![i])]);
            for (var i = 0; i < (f.Transfers?.Count ?? 0); i++)
            {
                var t = f.Transfers![i];
                await Insert(c, "atlas_field_transfers", [("field_id", f.Id), ("ordinal", i), ("feature_id", t.FeatureId), ("point", t.Position),
                    ("rate", t.Rate), ("storage_id", t.StorageId), ("source_field_id", t.FieldId)]);
            }
            await WriteLinks(c, f.Id, -1, f.Links);
            for (var i = 0; i < (f.HumanHistory?.Count ?? 0); i++)
            {
                var h = f.HumanHistory![i]; var snapshot = await WriteGrid(c, world, h.Surface);
                await Insert(c, "atlas_field_human_epochs", [("field_id", f.Id), ("ordinal", i), ("era", h.Era), ("grid_id", snapshot), ("events", h.Events.Select(DbHumanEvent.From).ToArray())]);
            }
        }
    }

    private static async Task WriteLinks(NpgsqlConnection c, Guid field, int epoch, List<FlowLink>? links)
    {
        for (var i = 0; i < (links?.Count ?? 0); i++)
        {
            var l = links![i];
            await Insert(c, "atlas_field_links", [("field_id", field), ("epoch_ordinal", epoch), ("ordinal", i), ("id", l.Id), ("a", l.A), ("b", l.B), ("rate", l.Rate), ("channel", l.Channel)]);
        }
    }

    private static async Task<Guid> WriteGrid(NpgsqlConnection c, Guid world, SampledPatch grid, double[]? measures = null)
    {
        var id = Guid.NewGuid();
        Guard.Require(grid.Values.Values.All(v => v.Length == grid.Width * grid.Height && v.All(double.IsFinite)), "invalid_field", "A grid channel requires complete finite values.");
        await Insert(c, "atlas_grids", [("id", id), ("world_id", world), ("bounds", grid.Bounds), ("width", grid.Width), ("height", grid.Height),
            ("measures", Null(measures, "float8[]")), ("has_water_bodies", grid.WaterBodies is not null)]);
        foreach (var channel in grid.Values) await Insert(c, "atlas_grid_channels", [("grid_id", id), ("name", channel.Key), ("values", channel.Value)]);
        for (var i = 0; i < (grid.WaterBodies?.Count ?? 0); i++)
        {
            var body = grid.WaterBodies![i];
            await Insert(c, "atlas_grid_water_bodies", [("grid_id", id), ("ordinal", i), ("id", body.Id), ("footprint", Spatial.Read(body.Footprint)),
                ("volume", body.Volume), ("spill", body.Spill), ("outlet", Null(body.Outlet, "atlas_position")), ("outlet_from", Null(body.OutletFrom, "atlas_position")),
                ("suspended", body.Suspended), ("fixed_level", Number(body.FixedLevel)), ("outlet_path", Null(body.OutletPath?.ToArray(), "atlas_position[]"))]);
            for (var j = 0; j < body.Slices.Count; j++)
            {
                var s = body.Slices[j];
                await Insert(c, "atlas_grid_lake_slices", [("grid_id", id), ("body_ordinal", i), ("ordinal", j), ("floor", s.Floor), ("area", s.Area),
                    ("footprint", Null(s.Footprint is null ? null : Spatial.Read(s.Footprint), "geometry")), ("sediment", s.Sediment)]);
            }
        }
        return id;
    }
}
