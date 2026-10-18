using Atlas.Domain;
using Npgsql;
using static Atlas.Persistence.Sql;

namespace Atlas.Persistence;

public sealed partial class Store
{
    private static async Task<Template> ReadTemplate(NpgsqlConnection c, Guid scope)
    {
        var rows = await Sql.Read(c, "SELECT * FROM atlas_template_definitions WHERE scope_id=$1", r => (
            Template: new Template(Id(r), Value<string>(r, "name"), (Profile)Value<int>(r, "profile"), Value<int[]>(r, "parent_profiles").Select(p => (Profile)p).ToList(),
                Shape(r, "footprint"), [], Value<DbTrait[]>(r, "traits").Select(t => t.Value()).ToList(), Value<LocalFrame>(r, "frame"), Value<string>(r, "units"),
                Requirements: Optional<DbRequirements>(r, "requirements")?.Value(), Recipe: Optional<DbRecipe>(r, "recipe")?.Value(), Version: Value<long>(r, "version"), Context: Value<string>(r, "context")),
            Entities: Value<bool>(r, "has_entities"), Layers: Value<bool>(r, "has_layers"), Sockets: Value<bool>(r, "has_sockets"), Spaces: Value<bool>(r, "has_spaces")), scope);
        Guard.Require(rows.Count == 1, "missing_template", "Template definition not found.");
        var row = rows[0];
        var features = await ReadFeatures(c, scope, 1);
        var entities = await ReadEntities(c, scope, 1);
        var layers = await ReadLayers(c, scope, 1);
        var members = await Sql.Read(c, "SELECT kind,id FROM atlas_template_members WHERE scope_id=$1 ORDER BY ordinal", r => (Kind: r.GetString(0), Id: r.GetString(1)), scope);
        var spaces = await Sql.Read(c, "SELECT * FROM atlas_template_spaces WHERE scope_id=$1 ORDER BY ordinal", r =>
            new TemplateSpace(Id(r), Value<string>(r, "name"), Shape(r, "footprint"), Value<LocalFrame>(r, "frame")), scope);
        var sockets = await Sql.Read(c, "SELECT * FROM atlas_template_sockets WHERE scope_id=$1 ORDER BY ordinal", r => new TemplateSocket(Value<string>(r, "id"), Value<Guid>(r, "feature_id"),
            Value<Position>(r, "point"), Value<string>(r, "kind"), Value<bool>(r, "required"), Optional<string[]>(r, "target_kinds")?.ToList(), Optional<Guid?>(r, "space_id"), Optional<string>(r, "connects_to")), scope);
        return row.Template with
        {
            Features = members.Where(v => v.Kind == "feature").Select(v => features[Guid.Parse(v.Id)]).ToList(),
            Entities = row.Entities ? members.Where(v => v.Kind == "entity").Select(v => entities[Guid.Parse(v.Id)]).ToList() : null,
            Layers = row.Layers ? members.Where(v => v.Kind == "layer").Select(v => layers[v.Id]).ToList() : null,
            Spaces = row.Spaces ? spaces : null, Sockets = row.Sockets ? sockets : null
        };
    }
}
