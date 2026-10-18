using Atlas.Domain;
using NetTopologySuite.Geometries;
using Npgsql;
using static Atlas.Persistence.Sql;
using Position = Atlas.Domain.Position;

namespace Atlas.Persistence;

public sealed partial class Store
{
    private static async Task ReadMetadata(NpgsqlConnection c, World w)
    {
        w.Magic = await At(c, "atlas_magic", w.Id, w.Version, r => new MagicRule(Id(r), Value<string>(r, "name"), Value<Position>(r, "source"),
            Value<double>(r, "radius"), Value<double>(r, "strength"), Value<string>(r, "propagation"), Value<string>(r, "effect"), Value<double>(r, "decay"),
            Value<double>(r, "storage"), Optional<Guid[]>(r, "depends_on")?.ToList(), Optional<Geometry>(r, "scope") is { } shape ? Spatial.Write(shape) : null,
            Value<int>(r, "starts_at_epoch")), "ordinal");
        var views = await At(c, "atlas_views", w.Id, w.Version, r => (Revision: RevisionId(r), View: new MapView(Id(r), Value<string>(r, "name"), Value<Guid>(r, "area_id"), [])), "ordinal");
        var byRevision = views.ToDictionary(v => v.Revision, v => v.View);
        var styles = await Sql.Read(c, "SELECT * FROM atlas_view_layers WHERE revision_id=ANY($1) ORDER BY ordinal", r => (Revision: RevisionId(r), Style: new MapLayerStyle(
            Value<string>(r, "layer_id"), Value<bool>(r, "visible"), Value<double>(r, "opacity"), Value<string>(r, "color"), Value<double>(r, "min_scale"),
            Value<bool>(r, "labels"), Optional<string>(r, "filter"))), byRevision.Keys.ToArray());
        foreach (var row in styles) byRevision[row.Revision].Layers.Add(row.Style);
        w.Views = views.Select(v => v.View).ToList();
        w.Fields = await At(c, "atlas_field_references", w.Id, w.Version, r => new FieldReference(Id(r), Value<Guid>(r, "area_id"), Value<string>(r, "layer_id"),
            Value<string>(r, "algorithm"), Value<Guid>(r, "job_id"), Value<int>(r, "samples"), Optional<string[]>(r, "channels")?.ToList()), "ordinal");
        w.Generations = await At(c, "atlas_generations", w.Id, w.Version, r => new GenerationRecord(Id(r), Value<Guid>(r, "area_id"), Value<int>(r, "seed"),
            Value<string>(r, "algorithm"), Value<string>(r, "quality"), Value<string[]>(r, "domains").ToList(), Value<int>(r, "boundary_version"),
            Value<Epoch[]>(r, "epochs").ToList(), Value<DateTimeOffset>(r, "completed_at"), Value<string[]>(r, "warnings").ToList()), "ordinal");
        var transfers = await At(c, "atlas_water_transfers", w.Id, w.Version, r => (Revision: RevisionId(r), Id: Id(r)));
        var items = await Sql.Read(c, "SELECT * FROM atlas_water_transfer_items WHERE revision_id=ANY($1) ORDER BY ordinal", r =>
            (Revision: RevisionId(r), Transfer: new WaterTransfer(Value<Guid>(r, "feature_id"), Value<Position>(r, "point"), Value<double>(r, "rate"), Value<Guid>(r, "storage_id"), Value<Guid>(r, "field_id"))),
            transfers.Select(v => v.Revision).ToArray());
        foreach (var item in transfers) w.WaterTransfers[item.Id] = items.Where(v => v.Revision == item.Revision).Select(v => v.Transfer).ToList();
    }
}
