using Atlas.Domain;
using Npgsql;
using System.Text.Json.Nodes;
using static Atlas.Persistence.Sql;

namespace Atlas.Persistence;

public sealed partial class Store
{
    private static async Task Register(NpgsqlConnection c, Guid scope, IEnumerable<Guid> identities)
    {
        await Execute(c, "INSERT INTO atlas_objects(scope_id,id,kind) SELECT $1,unnest($2::uuid[]),'domain' ON CONFLICT DO NOTHING", scope, identities.Distinct().ToArray());
    }

    private static IEnumerable<Guid> Identities(World w) => w.Areas.Keys.Concat(w.Features.Keys).Concat(w.Entities.Keys)
        .Concat(w.Connections.Keys).Concat(w.NetworkNodes.Keys).Concat(w.NetworkReaches.Keys).Concat(w.Magic.Select(m => m.Id))
        .Concat(w.Views.Select(v => v.Id)).Concat(w.Fields.Select(f => f.Id)).Concat(w.Generations.Select(g => g.Id)).Concat(w.WaterTransfers.Keys);

    private static async Task Revisions<TKey, T>(NpgsqlConnection c, string table, Guid scope, long version,
        Dictionary<TKey, T>? before, Dictionary<TKey, T> after, Func<Guid, T, Task> write) where TKey : notnull
    {
        foreach (var id in (before?.Keys.AsEnumerable() ?? []).Union(after.Keys))
        {
            var existed = before is not null && before.TryGetValue(id, out _);
            if (existed && after.TryGetValue(id, out var same) && JsonNode.DeepEquals(
                System.Text.Json.JsonSerializer.SerializeToNode(before![id], AtlasJson.Options),
                System.Text.Json.JsonSerializer.SerializeToNode(same, AtlasJson.Options))) continue;
            if (existed) await Execute(c, $"UPDATE {table} SET valid_to=$1 WHERE scope_id=$2 AND id=$3 AND valid_to IS NULL", version, scope, id);
            if (after.TryGetValue(id, out var value))
            {
                var revision = Guid.NewGuid();
                await Insert(c, "atlas_revision_owners", [("id", revision), ("scope_id", scope)]);
                await write(revision, value);
            }
        }
    }

    private static (string, object?)[] Revision(Guid revision, Guid scope, object id, long version, params (string, object?)[] values)
        => new (string, object?)[] { ("revision_id", revision), ("scope_id", scope), ("id", id), ("valid_from", version) }.Concat(values).ToArray();

    private static async Task SaveWorldRows(NpgsqlConnection c, World? before, World w)
    {
        await Register(c, w.Id, Identities(w));
        var crs = w.Reference;
        await Insert(c, "atlas_world_versions", [("world_id", w.Id), ("version", w.Version), ("name", w.Name), ("seed", w.Seed),
            ("crs_id", crs.Id), ("domain", Spatial.Read(crs.Domain)), ("topology", crs.Topology), ("units", crs.Units), ("axes", crs.Axes),
            ("vertical_datum", crs.VerticalDatum), ("crs_version", crs.Version), ("precision", crs.Precision), ("epochs", w.Epochs.ToArray()), ("human_eras", w.HumanEras.ToArray())]);
        await WriteAreas(c, before, w);
        await WriteLayers(c, w.Id, w.Version, before?.Layers, w.Layers);
        await WriteFeatures(c, w.Id, w.Version, before?.Features, w.Features);
        await WriteEntities(c, w.Id, w.Version, before?.Entities, w.Entities);
        await WriteNetworks(c, before, w);
        await WriteMetadata(c, before, w);
        await WriteWorldTemplates(c, before, w);
    }

    private static async Task WriteAreas(NpgsqlConnection c, World? before, World w)
    {
        await Revisions(c, "atlas_areas", w.Id, w.Version, before?.Areas, w.Areas, async (revision, a) =>
        {
            await Insert(c, "atlas_areas", Revision(revision, w.Id, a.Id, w.Version,
                ("parent_id", Uuid(a.ParentId)), ("name", a.Name), ("profile", (int)a.Profile), ("footprint", Spatial.Read(a.Footprint)), ("frame", a.Frame),
                ("boundary", Null(DbBoundary.From(a.Boundary), "atlas_boundary")), ("traits", a.Traits.Select(DbTrait.From).ToArray()),
                ("local_traits", Null(a.LocalTraits?.Select(DbTrait.From).ToArray(), "atlas_trait[]")), ("version", a.Version), ("template_id", Uuid(a.TemplateId)),
                ("context", a.Context), ("context_feature_id", Uuid(a.ContextFeatureId)), ("template_instance_id", Uuid(a.TemplateInstanceId)),
                ("recipe", Null(DbRecipe.From(a.Recipe), "atlas_recipe")), ("recipe_job_id", Uuid(a.RecipeJobId))));
            foreach (var layer in a.Layers) await Insert(c, "atlas_area_layers", [("revision_id", revision), ("layer_id", layer.Key), ("state", (int)layer.Value)]);
        });
    }

    private static async Task WriteLayers(NpgsqlConnection c, Guid scope, long version, Dictionary<string, Layer>? before, Dictionary<string, Layer> after)
    {
        await Revisions(c, "atlas_layers", scope, version, before, after, async (revision, l) =>
        {
            await Insert(c, "atlas_layers", Revision(revision, scope, l.Id, version, ("name", l.Name), ("family", l.Family),
                ("representation", l.Representation), ("color", l.Color), ("profiles", l.Profiles.Select(p => (int)p).ToArray()), ("generator", Text(l.Generator))));
            await WriteAttributes(c, revision, l.Schema, false);
        });
    }

    private static async Task WriteFeatures(NpgsqlConnection c, Guid scope, long version, Dictionary<Guid, Feature>? before, Dictionary<Guid, Feature> after)
    {
        await Revisions(c, "atlas_features", scope, version, before, after, async (revision, f) =>
        {
            await Insert(c, "atlas_features", Revision(revision, scope, f.Id, version,
                ("name", f.Name), ("kind", f.Kind), ("layer_id", f.LayerId), ("area_id", f.AreaId), ("geometry", Spatial.Read(f.Geometry)),
                ("state", (int)f.State), ("protected", f.Protected), ("actor", f.Actor), ("generation_id", Uuid(f.GenerationId)),
                ("generation_domain", Text(f.GenerationDomain)), ("causes", f.Causes.ToArray())));
            await WriteAttributes(c, revision, f.Attributes, true, f.Geometry);
            await WriteRelations(c, scope, revision, f.Relations);
            foreach (var (area, r) in f.Detail)
            {
                var detail = Guid.NewGuid();
                await Insert(c, "atlas_revision_owners", [("id", detail), ("scope_id", scope)]);
                await Insert(c, "atlas_representations", [("revision_id", detail), ("feature_revision", revision), ("area_id", area), ("geometry", Spatial.Read(r.Geometry)),
                    ("state", (int)r.State), ("actor", r.Actor), ("generation_id", Uuid(r.GenerationId)), ("protected", r.Protected),
                    ("needs_reconciliation", r.NeedsReconciliation), ("has_attributes", r.Attributes is not null)]);
                if (r.Attributes is not null) await WriteAttributes(c, detail, r.Attributes, true, r.Geometry);
            }
        });
    }

    private static async Task WriteEntities(NpgsqlConnection c, Guid scope, long version, Dictionary<Guid, Entity>? before, Dictionary<Guid, Entity> after)
    {
        await Revisions(c, "atlas_entities", scope, version, before, after, async (revision, e) =>
        {
            await Insert(c, "atlas_entities", Revision(revision, scope, e.Id, version, ("name", e.Name), ("kind", e.Kind), ("state", (int)e.State)));
            await WriteAttributes(c, revision, e.Attributes, true);
            await WriteRelations(c, scope, revision, e.Relations);
        });
    }

    private static async Task WriteRelations(NpgsqlConnection c, Guid scope, Guid revision, List<Relation> relations)
    {
        for (var i = 0; i < relations.Count; i++) await Insert(c, "atlas_relations", [("revision_id", revision), ("ordinal", i),
            ("scope_id", scope), ("target_id", relations[i].TargetId), ("kind", relations[i].Kind)]);
    }
}
