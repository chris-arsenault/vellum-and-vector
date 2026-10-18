using Atlas.Domain;
using NetTopologySuite.Geometries;
using Npgsql;
using static Atlas.Persistence.Sql;
using Position = Atlas.Domain.Position;

namespace Atlas.Persistence;

public sealed partial class Store
{
    private static Task<List<T>> At<T>(NpgsqlConnection c, string table, Guid scope, long version, Func<NpgsqlDataReader, T> map, string order = "id") =>
        Sql.Read(c, $"SELECT * FROM {table} WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) ORDER BY {order}", map, scope, version);
    private static Guid Id(NpgsqlDataReader r) => Value<Guid>(r, "id");
    private static Guid RevisionId(NpgsqlDataReader r) => Value<Guid>(r, "revision_id");
    private static System.Text.Json.Nodes.JsonObject Shape(NpgsqlDataReader r, string name) => Spatial.Write(Value<Geometry>(r, name));

    internal static async Task<World> ReadVersion(NpgsqlConnection c, Guid id, long version, bool objects = true)
    {
        var metadata = await Sql.Read(c, "SELECT v.*,w.owner FROM atlas_world_versions v JOIN atlas_worlds w ON w.id=v.world_id WHERE v.world_id=$1 AND v.version=$2", r => new World
        {
            Id = id, Version = version, Name = Value<string>(r, "name"), Owner = Value<string>(r, "owner"), Seed = Value<int>(r, "seed"),
            Reference = new(Value<string>(r, "crs_id"), Shape(r, "domain"), Value<string>(r, "topology"), Value<string>(r, "units"), Value<string>(r, "axes"),
                Value<string>(r, "vertical_datum"), Value<int>(r, "crs_version"), Value<double>(r, "precision")),
            Epochs = Value<Epoch[]>(r, "epochs").ToList(), HumanEras = Value<HumanEra[]>(r, "human_eras").ToList()
        }, id, version);
        Guard.Require(metadata.Count == 1, "not_found", "World revision not found.");
        var w = metadata[0];
        await ReadAreas(c, w);
        w.Layers = await ReadLayers(c, id, version);
        w.Entities = await ReadEntities(c, id, version);
        await ReadMetadata(c, w);
        w.Connections = (await At(c, "atlas_connections", id, version, r => new Connection(Id(r), Value<string>(r, "kind"),
            new(Value<Guid>(r, "a_area"), Value<Position>(r, "a_point"), Optional<Guid?>(r, "a_feature")),
            new(Value<Guid>(r, "b_area"), Value<Position>(r, "b_point"), Optional<Guid?>(r, "b_feature")), Value<double>(r, "flow")))).ToDictionary(v => v.Id);
        if (objects)
        {
            w.Features = await ReadFeatures(c, id, version);
            w.NetworkNodes = (await At(c, "atlas_nodes", id, version, r => new NetworkNode(Id(r), Value<string>(r, "kind"), Value<Position>(r, "point"),
                Optional<Guid?>(r, "space_id"), Optional<double?>(r, "water_level")))).ToDictionary(v => v.Id);
            w.NetworkReaches = (await At(c, "atlas_reaches", id, version, r => new NetworkReach(Id(r), Value<Guid>(r, "feature_id"), Value<Guid>(r, "start_id"),
                Value<Guid>(r, "end_id"), Shape(r, "geometry"), Value<double>(r, "flow"), Optional<double?>(r, "end_flow")))).ToDictionary(v => v.Id);
        }
        var templateScopes = await At(c, "atlas_world_templates", id, version, r => Value<Guid>(r, "definition_scope"));
        foreach (var scope in templateScopes) { var template = await ReadTemplate(c, scope); w.Templates[template.Id] = template; }
        return w;
    }

    private static async Task ReadAreas(NpgsqlConnection c, World w)
    {
        var rows = await At(c, "atlas_areas", w.Id, w.Version, r => (Revision: RevisionId(r), Area: new Area
        {
            Id = Id(r), ParentId = Optional<Guid?>(r, "parent_id"), Name = Value<string>(r, "name"), Profile = (Profile)Value<int>(r, "profile"),
            Footprint = Shape(r, "footprint"), Frame = Value<LocalFrame>(r, "frame"), Boundary = Optional<DbBoundary>(r, "boundary")?.Value(),
            Traits = Value<DbTrait[]>(r, "traits").Select(t => t.Value()).ToList(), LocalTraits = Optional<DbTrait[]>(r, "local_traits")?.Select(t => t.Value()).ToList(),
            Version = Value<long>(r, "version"), TemplateId = Optional<Guid?>(r, "template_id"), Context = Value<string>(r, "context"),
            ContextFeatureId = Optional<Guid?>(r, "context_feature_id"), TemplateInstanceId = Optional<Guid?>(r, "template_instance_id"),
            Recipe = Optional<DbRecipe>(r, "recipe")?.Value(), RecipeJobId = Optional<Guid?>(r, "recipe_job_id")
        }));
        var byRevision = rows.ToDictionary(v => v.Revision, v => v.Area);
        var states = await Sql.Read(c, "SELECT * FROM atlas_area_layers WHERE revision_id=ANY($1)", r =>
            (Revision: RevisionId(r), Layer: Value<string>(r, "layer_id"), State: (Materialization)Value<int>(r, "state")), byRevision.Keys.ToArray());
        foreach (var row in states) byRevision[row.Revision].Layers[row.Layer] = row.State;
        w.Areas = rows.ToDictionary(v => v.Area.Id, v => v.Area);
    }

    private static async Task<Dictionary<string, Layer>> ReadLayers(NpgsqlConnection c, Guid scope, long version)
    {
        var rows = await At(c, "atlas_layers", scope, version, r => (Revision: RevisionId(r), Layer: new Layer(Value<string>(r, "id"), Value<string>(r, "name"),
            Value<string>(r, "family"), Value<string>(r, "representation"), Value<string>(r, "color"), Value<int[]>(r, "profiles").Select(p => (Profile)p).ToList(), [], Optional<string>(r, "generator"))));
        var attributes = await ReadAttributes(c, rows.Select(v => v.Revision));
        return rows.ToDictionary(v => v.Layer.Id, v => v.Layer with { Schema = attributes[v.Revision] });
    }

    private static async Task<Dictionary<Guid, Entity>> ReadEntities(NpgsqlConnection c, Guid scope, long version)
    {
        var rows = await At(c, "atlas_entities", scope, version, r => (Revision: RevisionId(r), Entity: new Entity(Id(r), Value<string>(r, "name"), Value<string>(r, "kind"), [], [], (Materialization)Value<int>(r, "state"))));
        var attributes = await ReadAttributes(c, rows.Select(v => v.Revision));
        var relations = await ReadRelations(c, rows.Select(v => v.Revision));
        return rows.ToDictionary(v => v.Entity.Id, v => v.Entity with { Attributes = attributes[v.Revision], Relations = relations[v.Revision] });
    }

    private static async Task<Dictionary<Guid, Feature>> ReadFeatures(NpgsqlConnection c, Guid scope, long version, Guid[]? ids = null)
    {
        var rows = await Sql.Read(c, "SELECT * FROM atlas_features WHERE scope_id=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2) AND ($3::uuid[] IS NULL OR id=ANY($3)) ORDER BY id", r =>
            (Revision: RevisionId(r), Feature: new Feature
            {
                Id = Id(r), Name = Value<string>(r, "name"), Kind = Value<string>(r, "kind"), LayerId = Value<string>(r, "layer_id"), AreaId = Value<Guid>(r, "area_id"),
                Geometry = Shape(r, "geometry"), State = (Materialization)Value<int>(r, "state"), Protected = Value<bool>(r, "protected"), Actor = Value<string>(r, "actor"),
                GenerationId = Optional<Guid?>(r, "generation_id"), GenerationDomain = Optional<string>(r, "generation_domain"), Causes = Value<string[]>(r, "causes").ToList()
            }), scope, version, Null(ids, "uuid[]"));
        var byRevision = rows.ToDictionary(v => v.Revision, v => v.Feature);
        var details = await Sql.Read(c, "SELECT * FROM atlas_representations WHERE feature_revision=ANY($1) ORDER BY area_id", r =>
            (Revision: RevisionId(r), Parent: Value<Guid>(r, "feature_revision"), Area: Value<Guid>(r, "area_id"), HasAttributes: Value<bool>(r, "has_attributes"),
            Representation: new Representation(Shape(r, "geometry"), (Materialization)Value<int>(r, "state"), Value<string>(r, "actor"), Optional<Guid?>(r, "generation_id"),
                null, Value<bool>(r, "protected"), Value<bool>(r, "needs_reconciliation"))), byRevision.Keys.ToArray());
        var attributes = await ReadAttributes(c, rows.Select(v => v.Revision).Concat(details.Select(v => v.Revision)));
        var relations = await ReadRelations(c, rows.Select(v => v.Revision));
        foreach (var row in rows) { row.Feature.Attributes = attributes[row.Revision]; row.Feature.Relations = relations[row.Revision]; }
        foreach (var row in details) byRevision[row.Parent].Detail[row.Area] = row.Representation with { Attributes = row.HasAttributes ? attributes[row.Revision] : null };
        return rows.ToDictionary(v => v.Feature.Id, v => v.Feature);
    }

    private static async Task<Dictionary<Guid, List<Relation>>> ReadRelations(NpgsqlConnection c, IEnumerable<Guid> revisions)
    {
        var result = revisions.ToDictionary(v => v, _ => new List<Relation>());
        var rows = await Sql.Read(c, "SELECT * FROM atlas_relations WHERE revision_id=ANY($1) ORDER BY ordinal", r =>
            (Revision: RevisionId(r), Relation: new Relation(Value<Guid>(r, "target_id"), Value<string>(r, "kind"))), result.Keys.ToArray());
        foreach (var row in rows) result[row.Revision].Add(row.Relation);
        return result;
    }
}
