using System.Text.Json.Nodes;

namespace Atlas.Domain;

public static class Reconciliation
{
    public static Proposal Preview(World world, JsonObject data, string actor, IReadOnlyList<FieldData> fields, Guid operationId)
    {
        if (data["sculpt"] is JsonObject sculpt) return Field(world, data, sculpt, actor, fields, operationId);
        var featureId = data["featureId"]!.GetValue<Guid>();
        Guard.Require(world.Features.TryGetValue(featureId, out var feature), "missing_feature", "Choose an existing network feature.");
        var before = AtlasJson.Clone(world);
        Topology.Rebuild(before);
        var proposed = AtlasJson.Clone(feature!);
        proposed.Geometry = data["geometry"]!.AsObject();
        if (data["attributes"] is JsonObject attributes) proposed.Attributes = AtlasJson.Clone(attributes);
        var edits = new List<EditFeature> { new(data["areaId"]?.GetValue<Guid>() ?? proposed.AreaId, proposed) };
        if (data["changes"] is JsonArray changes) edits.AddRange(changes.Select(change => AtlasJson.Read<EditFeature>(change!)));
        var ids = Dependencies.Affected(before, [featureId]);
        foreach (var edit in edits) Apply(world, edit, actor, fields);
        Dependencies.ValidateBindings(world);
        foreach (var id in ids)
            foreach (var (area, detail) in world.Features[id].Detail.ToList())
                if (!edits.Any(e => e.Feature.Id == id && e.AreaId == area))
                    world.Features[id].Detail[area] = detail with { NeedsReconciliation = true };
        var connectionEdits = (data["connections"] as JsonArray ?? []).Select(value => AtlasJson.Read<Connection>(value!)).ToList();
        foreach (var connection in connectionEdits) world.Connections[connection.Id] = connection;
        foreach (var connection in world.Connections.Values) Networks.Validate(world, connection);
        Topology.Rebuild(world);
        ids.UnionWith(Dependencies.Affected(world, [featureId]));
        Guard.Require(edits.All(edit => ids.Contains(edit.Feature.Id)), "reconciliation_scope", "Additional edits must belong to the old or new dependency graph.");
        var extent = ids.SelectMany(id => new[] { Composition.Geometry(before, before.Features[id]), Composition.Geometry(world, world.Features[id]) }).ToList();
        var connectionAreas = connectionEdits.SelectMany(c => new[] { c.A.AreaId, c.B.AreaId })
            .Concat(connectionEdits.Where(c => before.Connections.ContainsKey(c.Id)).SelectMany(c => new[] { before.Connections[c.Id].A.AreaId, before.Connections[c.Id].B.AreaId })).ToHashSet();
        var affected = world.Areas.Values.Where(a => connectionAreas.Contains(a.Id) || extent.Any(g => Spatial.Read(a.Footprint).Intersects(g))).ToList();
        var impact = new Impact(ids.ToList(), affected.Select(a => a.Id).ToList(), ids.Select(id => world.Features[id].LayerId).Distinct().ToList(),
            affected.Select(a => $"{a.Name}: boundary inputs and dependent detail need reconciliation").ToList(), true);
        if (data["confirm"]?.GetValue<bool>() == true)
        {
            var versions = AtlasJson.Read<Dictionary<Guid, long>>(data["areaVersions"]!);
            Guard.Require(affected.All(a => versions.GetValueOrDefault(a.Id) == a.Version),
                "reconciliation_conflict", "Inspect and confirm the current versions of all affected areas.");
        }
        foreach (var area in affected)
        {
            area.Version++;
            foreach (var key in area.Layers.Keys.ToList())
                if (area.Layers[key] == Materialization.Generated) area.Layers[key] = Materialization.Stale;
            if (area.ParentId is not null)
            {
                var contract = Refinement.Contract(world, area, fields);
                area.Boundary = contract with { Version = (area.Boundary?.Version ?? 0) + 1 };
            }
        }
        world.Version++;
        return new(world, impact);
    }

    private static void Apply(World world, EditFeature edit, string actor, IReadOnlyList<FieldData> fields)
    {
        Guard.Require(world.Features.TryGetValue(edit.Feature.Id, out var target) && world.Areas.ContainsKey(edit.AreaId), "missing_feature", "Choose a located existing feature.");
        var area = world.Areas[edit.AreaId];
        Guard.Require(Composition.Descendant(world, area.Id, target!.AreaId) && Composition.Space(world, area.Id) == Composition.Space(world, target.AreaId),
            "feature_scope", "Reconcile the feature in its owning space or a compatible descendant.");
        Guard.Require(!actor.StartsWith("agent:", StringComparison.Ordinal) || !target.Protected && target.Detail.GetValueOrDefault(area.Id)?.Protected != true,
            "protected_feature", "Agents cannot reconcile protected authored geometry.");
        Guard.Require(edit.Feature.Kind == target.Kind && edit.Feature.LayerId == target.LayerId &&
            world.Layers[target.LayerId].Profiles.Contains(area.Profile), "feature_identity", "Reconciliation preserves feature kind and registered layer.");
        Guard.Require(Spatial.Read(area.Footprint).Covers(Spatial.Read(edit.Feature.Geometry)), "outside_area", "A reconciled representation must stay within its owning area.");
        Commands.ValidateAttributes(world.Layers[target.LayerId], edit.Feature.Attributes);
        Guard.Require(edit.Feature.Relations.All(r => world.Features.ContainsKey(r.TargetId) || world.Entities.ContainsKey(r.TargetId) || world.Areas.ContainsKey(r.TargetId)),
            "missing_relation", "Reconciled feature relationships must resolve.");
        Hydrology.Prepare(world, area, edit.Feature, fields);
        Hydrology.ValidateLift(world, edit.Feature);
        Refinement.ValidateRiver(edit.Feature, edit.Feature.Geometry);
        target.Name = edit.Feature.Name;
        target.Relations = edit.Feature.Relations;
        if (target.AreaId == edit.AreaId)
        {
            target.Geometry = edit.Feature.Geometry;
            target.Attributes = edit.Feature.Attributes;
            target.State = Materialization.Authored;
            target.Actor = actor;
            target.Protected = edit.Feature.Protected;
        }
        else target.Detail[edit.AreaId] = new(edit.Feature.Geometry, Materialization.Authored, actor,
            Attributes: edit.Feature.Attributes, Protected: edit.Feature.Protected);
    }

    private static Proposal Field(World world, JsonObject data, JsonObject sculpt, string actor, IReadOnlyList<FieldData> fields, Guid operationId)
    {
        var input = AtlasJson.Read<Sculpt>(sculpt);
        Guard.Require(world.Areas.ContainsKey(input.AreaId), "missing_area", "Select a mapped area.");
        var ids = new HashSet<Guid> { input.AreaId };
        foreach (var area in world.Areas.Values.OrderBy(a => a.Profile))
            if (area.ParentId is { } parent && ids.Contains(parent)) ids.Add(area.Id);
        var affected = world.Areas.Values.Where(a => ids.Contains(a.Id)).OrderBy(a => a.Profile).ToList();
        if (data["confirm"]?.GetValue<bool>() == true)
        {
            var versions = AtlasJson.Read<Dictionary<Guid, long>>(data["areaVersions"]!);
            Guard.Require(affected.All(a => versions.GetValueOrDefault(a.Id) == a.Version), "reconciliation_conflict", "Inspect and confirm the current affected-area versions.");
        }
        var impact = new Impact([], ids.ToList(), [input.Channel], affected.Select(a => $"{a.Name}: environmental boundary and derived detail will change").ToList(), true);
        var command = new Command(operationId, world.Version, "sculptField", sculpt);
        var field = FieldEdits.Sculpt(world, command, fields, impact, true, actor);
        impact.Areas.Clear();
        impact.Areas.AddRange(ids);
        var previous = fields.Last(f => f.AreaId == input.AreaId && f.Values.ContainsKey(input.Channel));
        var updated = fields.Where(f => f.Id != previous.Id).Append(field).ToList();
        foreach (var area in affected)
        {
            if (area.Id == input.AreaId) continue;
            foreach (var key in area.Layers.Keys.ToList())
                if (area.Layers[key] == Materialization.Generated) area.Layers[key] = Materialization.Stale;
            area.Boundary = Refinement.Contract(world, area, updated) with { Version = (area.Boundary?.Version ?? 0) + 1 };
            Refinement.ValidateBoundaryTraits(area);
            area.Version++;
        }
        world.Version++;
        return new(world, impact, [field]);
    }
}
