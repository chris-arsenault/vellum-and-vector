using Atlas.Domain;
using NetTopologySuite.Geometries;
using Npgsql;
using static Atlas.Persistence.Sql;
using Position = Atlas.Domain.Position;

namespace Atlas.Persistence;

public sealed partial class Store
{
    private sealed record FieldRow(Guid Id, Guid Area, Guid Grid, string Algorithm, int Seed, FieldBoundary? Boundary, Guid? Initial,
        bool Authored, bool History, bool Budgets, bool Transfers, bool Links, bool Humans);

    private static async Task<List<FieldData>> ReadFields(NpgsqlConnection c, Guid world, IEnumerable<Guid> requested)
    {
        var ids = requested.Distinct().ToArray();
        var rows = await Sql.Read(c, "SELECT * FROM atlas_fields WHERE world_id=$1 AND id=ANY($2)", r => new FieldRow(Id(r), Value<Guid>(r, "area_id"), Value<Guid>(r, "grid_id"),
            Value<string>(r, "algorithm"), Value<int>(r, "seed"), Optional<DbFieldBoundary>(r, "boundary")?.Value(), Optional<Guid?>(r, "initial_grid"),
            Value<bool>(r, "has_authored"), Value<bool>(r, "has_history"), Value<bool>(r, "has_budgets"), Value<bool>(r, "has_transfers"), Value<bool>(r, "has_links"), Value<bool>(r, "has_human_history")), world, ids);
        var masks = await Sql.Read(c, "SELECT * FROM atlas_field_protections WHERE field_id=ANY($1) ORDER BY ordinal", r =>
            (Field: Value<Guid>(r, "field_id"), Id: Id(r), Footprint: Shape(r, "footprint"), Channels: Value<string[]>(r, "channels"), Actor: Value<string>(r, "actor"), Grid: Optional<Guid?>(r, "grid_id")), ids);
        var epochs = await Sql.Read(c, "SELECT * FROM atlas_field_epochs WHERE field_id=ANY($1) ORDER BY ordinal", r =>
            (Field: Value<Guid>(r, "field_id"), Index: Value<int>(r, "ordinal"), Epoch: Value<Epoch>(r, "epoch"), Grid: Value<Guid>(r, "grid_id"), Forcing: Value<Guid[]>(r, "forcing"), HasLinks: Value<bool>(r, "has_links")), ids);
        var human = await Sql.Read(c, "SELECT * FROM atlas_field_human_epochs WHERE field_id=ANY($1) ORDER BY ordinal", r =>
            (Field: Value<Guid>(r, "field_id"), Era: Value<HumanEra>(r, "era"), Grid: Value<Guid>(r, "grid_id"), Events: Value<DbHumanEvent[]>(r, "events")), ids);
        var links = await Sql.Read(c, "SELECT * FROM atlas_field_links WHERE field_id=ANY($1) ORDER BY ordinal", r =>
            (Field: Value<Guid>(r, "field_id"), Epoch: Value<int>(r, "epoch_ordinal"), Link: new FlowLink(Id(r), Value<Position>(r, "a"), Value<Position>(r, "b"), Value<double>(r, "rate"), Value<bool>(r, "channel"))), ids);
        var budgets = await Sql.Read(c, "SELECT * FROM atlas_field_budgets WHERE field_id=ANY($1) ORDER BY ordinal", r =>
            (Field: Value<Guid>(r, "field_id"), Budget: Value<PhysicalBudget>(r, "budget")), ids);
        var transfers = await Sql.Read(c, "SELECT * FROM atlas_field_transfers WHERE field_id=ANY($1) ORDER BY ordinal", r =>
            (Field: Value<Guid>(r, "field_id"), Transfer: new WaterTransfer(Value<Guid>(r, "feature_id"), Value<Position>(r, "point"), Value<double>(r, "rate"), Value<Guid>(r, "storage_id"), Value<Guid>(r, "source_field_id"))), ids);
        var gridIds = rows.Select(r => r.Grid).Concat(rows.Select(r => r.Initial).OfType<Guid>()).Concat(masks.Select(m => m.Grid).OfType<Guid>()).Concat(epochs.Select(e => e.Grid)).Concat(human.Select(h => h.Grid)).Distinct().ToArray();
        var grids = await ReadGrids(c, world, gridIds);
        var result = new Dictionary<Guid, FieldData>();
        foreach (var row in rows)
        {
            var grid = grids[row.Grid];
            var f = new FieldData(row.Id, row.Area, grid.Patch.Bounds, grid.Patch.Width, grid.Patch.Height, grid.Patch.Values, row.Algorithm, row.Seed, row.Boundary,
                row.Authored ? masks.Where(m => m.Field == row.Id).Select(m => new FieldProtection(m.Id, m.Footprint, m.Channels.ToList(), m.Actor, m.Grid is { } id ? grids[id].Patch : null)).ToList() : null,
                row.History ? epochs.Where(e => e.Field == row.Id).Select(e => new FieldEpoch(e.Epoch, grids[e.Grid].Patch, e.Forcing.ToList(), e.HasLinks ? links.Where(l => l.Field == row.Id && l.Epoch == e.Index).Select(l => l.Link).ToList() : null)).ToList() : null,
                row.Budgets ? budgets.Where(b => b.Field == row.Id).Select(b => b.Budget).ToList() : null,
                row.Initial is { } initial ? grids[initial].Patch : null,
                row.Transfers ? transfers.Where(t => t.Field == row.Id).Select(t => t.Transfer).ToList() : null,
                row.Links ? links.Where(l => l.Field == row.Id && l.Epoch == -1).Select(l => l.Link).ToList() : null,
                grid.Measures, grid.Patch.WaterBodies,
                row.Humans ? human.Where(h => h.Field == row.Id).Select(h => new HumanSnapshot(h.Era, grids[h.Grid].Patch, h.Events.Select(e => e.Value()).ToList())).ToList() : null);
            f.Validate(); result.Add(f.Id, f);
        }
        return ids.Where(result.ContainsKey).Select(id => result[id]).ToList();
    }

    private static async Task<Dictionary<Guid, (SampledPatch Patch, double[]? Measures)>> ReadGrids(NpgsqlConnection c, Guid world, Guid[] ids)
    {
        var grids = await Sql.Read(c, "SELECT * FROM atlas_grids WHERE world_id=$1 AND id=ANY($2)", r => (Id: Id(r), Bounds: Value<double[]>(r, "bounds"), Width: Value<int>(r, "width"),
            Height: Value<int>(r, "height"), Measures: Optional<double[]>(r, "measures"), Bodies: Value<bool>(r, "has_water_bodies")), world, ids);
        var channels = await Sql.Read(c, "SELECT * FROM atlas_grid_channels WHERE grid_id=ANY($1) ORDER BY name", r =>
            (Grid: Value<Guid>(r, "grid_id"), Name: Value<string>(r, "name"), Values: Value<double[]>(r, "values")), ids);
        var bodies = await Sql.Read(c, "SELECT * FROM atlas_grid_water_bodies WHERE grid_id=ANY($1) ORDER BY ordinal", r =>
            (Grid: Value<Guid>(r, "grid_id"), Index: Value<int>(r, "ordinal"), Body: new WaterBodyState(Id(r), Shape(r, "footprint"), [], Value<double>(r, "volume"), Value<double>(r, "spill"),
                Optional<Position>(r, "outlet"), Optional<Position>(r, "outlet_from"), Value<double>(r, "suspended"), Optional<double?>(r, "fixed_level"), Optional<Position[]>(r, "outlet_path")?.ToList())), ids);
        var slices = await Sql.Read(c, "SELECT * FROM atlas_grid_lake_slices WHERE grid_id=ANY($1) ORDER BY ordinal", r =>
            (Grid: Value<Guid>(r, "grid_id"), Body: Value<int>(r, "body_ordinal"), Slice: new LakeSlice(Value<double>(r, "floor"), Value<double>(r, "area"),
                Optional<Geometry>(r, "footprint") is { } shape ? Spatial.Write(shape) : null, Value<double>(r, "sediment"))), ids);
        foreach (var body in bodies) body.Body.Slices.AddRange(slices.Where(s => s.Grid == body.Grid && s.Body == body.Index).Select(s => s.Slice));
        return grids.ToDictionary(g => g.Id, g => (new SampledPatch(g.Bounds, g.Width, g.Height,
            channels.Where(v => v.Grid == g.Id).ToDictionary(v => v.Name, v => v.Values), g.Bodies ? bodies.Where(b => b.Grid == g.Id).Select(b => b.Body).ToList() : null), g.Measures));
    }
}
