using Atlas.Domain;
using Atlas.Generation;
using Npgsql;
using static Atlas.Persistence.Sql;

namespace Atlas.Persistence;

public sealed partial class Store
{
    public async Task<List<Template>> ListTemplates(string owner)
    {
        await using var c = await source.OpenConnectionAsync();
        await using var transaction = await c.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead);
        var scopes = await Sql.Read(c, "SELECT definition_scope FROM atlas_templates WHERE owner=$1 ORDER BY updated_at DESC", r => r.GetGuid(0), owner);
        var result = new List<Template>();
        foreach (var scope in scopes) result.Add(await ReadTemplate(c, scope));
        return result;
    }

    public async Task<Template> SaveTemplate(Template template, string owner)
    {
        Templates.ValidateDefinition(template);
        await using var c = await source.OpenConnectionAsync();
        await using var transaction = await c.BeginTransactionAsync();
        await Execute(c, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", $"template:{owner}:{template.Id}");
        await using var read = Command(c, "SELECT version FROM atlas_templates WHERE owner=$1 AND id=$2 FOR UPDATE", owner, template.Id);
        var current = await read.ExecuteScalarAsync();
        Guard.Require(current is null || (long)current == template.Version, "version_conflict", "Reload the current template before replacing its definition.");
        var saved = template with { Version = current is null ? 1 : (long)current + 1 };
        var scope = await WriteTemplate(c, saved, owner);
        await Execute(c, "INSERT INTO atlas_templates(owner,id,version,definition_scope) VALUES($1,$2,$3,$4) ON CONFLICT(owner,id) DO UPDATE SET version=EXCLUDED.version,definition_scope=EXCLUDED.definition_scope,updated_at=now()", owner, saved.Id, saved.Version, scope);
        await transaction.CommitAsync();
        return saved;
    }

    private static async Task<World> WithTemplate(NpgsqlConnection c, World world, Atlas.Domain.Command command, string owner)
    {
        if (command.Kind != "instantiateTemplate") return world;
        var id = command.Data["templateId"]!.GetValue<Guid>();
        var requested = command.Data["definitionVersion"]?.GetValue<long>();
        if (world.Templates.TryGetValue(id, out var existing) && (requested is null || requested == existing.Version)) return world;
        await using var read = Command(c, "SELECT definition_scope FROM atlas_templates WHERE owner=$1 AND id=$2", owner, id);
        var scope = await read.ExecuteScalarAsync();
        Guard.Require(scope is Guid, "missing_template", "The template is not in your library or this world.");
        var enriched = AtlasJson.Clone(world);
        enriched.Templates[id] = await ReadTemplate(c, (Guid)scope!);
        return enriched;
    }

    private static async Task WriteWorldTemplates(NpgsqlConnection c, World? before, World w)
    {
        await Revisions(c, "atlas_world_templates", w.Id, w.Version, before?.Templates, w.Templates, async (r, t) =>
        {
            var scope = await WriteTemplate(c, t, w.Owner, w);
            await Insert(c, "atlas_world_templates", Revision(r, w.Id, t.Id, w.Version, ("definition_scope", scope)));
        });
    }

    private static async Task<Guid> WriteTemplate(NpgsqlConnection c, Template t, string owner, World? context = null)
    {
        var contextRefs = t.Features.SelectMany(f => f.Relations).Select(r => r.TargetId).Where(id => context?.Entities.ContainsKey(id) == true &&
            !(t.Entities ?? []).Any(e => e.Id == id) && !t.Features.Any(f => f.Id == id)).Distinct().Order().ToArray();
        var scope = Registry.Identity(t.Id, $"template-definition:{owner}:{(contextRefs.Length > 0 ? context!.Id : Guid.Empty)}:{Hash(t)}");
        await Execute(c, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", scope.ToString());
        await using var exists = Command(c, "SELECT 1 FROM atlas_template_definitions WHERE scope_id=$1", scope);
        if (await exists.ExecuteScalarAsync() is not null) return scope;
        await Insert(c, "atlas_scopes", [("id", scope), ("owner", owner), ("kind", "template")]);
        await Register(c, scope, t.Features.Select(f => f.Id).Concat((t.Entities ?? []).Select(e => e.Id))
            .Concat(t.Features.Select(f => f.AreaId)).Concat(t.Features.SelectMany(f => f.Detail.Keys)).Concat((t.Spaces ?? []).Select(s => s.Id)).Concat(contextRefs).Append(Guid.Empty));
        await Insert(c, "atlas_template_definitions", [("scope_id", scope), ("id", t.Id), ("version", t.Version), ("name", t.Name), ("profile", (int)t.Profile),
            ("parent_profiles", t.ParentProfiles.Select(p => (int)p).ToArray()), ("footprint", Spatial.Read(t.Footprint)), ("traits", t.Traits.Select(DbTrait.From).ToArray()),
            ("frame", t.Frame), ("units", t.Units), ("requirements", Null(DbRequirements.From(t.Requirements), "atlas_template_requirements")),
            ("recipe", Null(DbRecipe.From(t.Recipe), "atlas_recipe")), ("context", t.Context), ("has_entities", t.Entities is not null), ("has_layers", t.Layers is not null),
            ("has_sockets", t.Sockets is not null), ("has_spaces", t.Spaces is not null)]);
        foreach (var target in contextRefs) await Insert(c, "atlas_template_context_refs", [("scope_id", scope), ("target_id", target), ("world_scope", context!.Id)]);
        await WriteFeatures(c, scope, 1, null, t.Features.ToDictionary(f => f.Id));
        await WriteEntities(c, scope, 1, null, (t.Entities ?? []).ToDictionary(e => e.Id));
        await WriteLayers(c, scope, 1, null, (t.Layers ?? []).ToDictionary(l => l.Id));
        foreach (var (kind, ids) in new[] { ("feature", t.Features.Select(f => f.Id.ToString())), ("entity", (t.Entities ?? []).Select(e => e.Id.ToString())), ("layer", (t.Layers ?? []).Select(l => l.Id)) })
        {
            var ordinal = 0;
            foreach (var id in ids) await Insert(c, "atlas_template_members", [("scope_id", scope), ("kind", kind), ("ordinal", ordinal++), ("id", id)]);
        }
        for (var i = 0; i < (t.Spaces?.Count ?? 0); i++)
        {
            var s = t.Spaces![i];
            await Insert(c, "atlas_template_spaces", [("scope_id", scope), ("ordinal", i), ("id", s.Id), ("name", s.Name), ("footprint", Spatial.Read(s.Footprint)), ("frame", s.Frame)]);
        }
        for (var i = 0; i < (t.Sockets?.Count ?? 0); i++)
        {
            var s = t.Sockets![i];
            await Insert(c, "atlas_template_sockets", [("scope_id", scope), ("ordinal", i), ("id", s.Id), ("feature_id", s.FeatureId), ("point", s.Position),
                ("kind", s.Kind), ("required", s.Required), ("target_kinds", Null(s.TargetKinds?.ToArray(), "text[]")), ("space_id", Uuid(s.SpaceId)), ("connects_to", Text(s.ConnectsTo))]);
        }
        return scope;
    }

    private static List<GenerationRequest> PrepareRecipes(World before, World candidate, Atlas.Domain.Command operation)
    {
        var areas = candidate.Areas.Values.Where(a => !before.Areas.ContainsKey(a.Id) && a.Recipe is not null).ToList();
        foreach (var area in areas) area.RecipeJobId = Registry.Identity(operation.OperationId, $"template-recipe:{area.Id}");
        return areas.Select(area =>
        {
            var recipe = area.Recipe!;
            var request = new GenerationRequest(area.RecipeJobId!.Value, candidate.Version, area.Id, recipe.Domains, recipe.Seed, recipe.Quality);
            Registry.Validate(candidate, request);
            return request;
        }).ToList();
    }
}
