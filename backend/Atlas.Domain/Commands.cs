using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Atlas.Domain;

public static class AtlasJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    { Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }, WriteIndented = false };
    public static T Clone<T>(T value) => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value, Options), Options)!;
    public static T Read<T>(JsonNode value) => value.Deserialize<T>(Options) ?? throw new DomainException("invalid_command", "Missing command data.");
}

public sealed record Command(Guid OperationId, long ExpectedVersion, string Kind, JsonObject Data);
public sealed record Impact(List<Guid> Features, List<Guid> Areas, List<string> Layers, List<string> Invalidations, bool HighImpact);
public sealed record Proposal(World Candidate, Impact Impact, List<FieldData>? Artifacts = null);
public sealed record CreateWorld(string Name, int Seed, double Width, double Height, List<Trait>? Traits = null, string Topology = "planar");
public sealed record CreateArea(Guid ParentId, string Name, Profile Profile, JsonObject Footprint,
    LocalFrame Frame, string Approach, List<string> Domains, List<Trait>? Traits = null, Guid? Id = null, string Context = "landscape", Guid? ContextFeatureId = null, bool CreateEntrance = true);
public sealed record EditFeature(Guid AreaId, Feature Feature);
public sealed record Instantiate(Guid TemplateId, Guid ParentId, string Name, LocalFrame Frame, Guid? ContextFeatureId = null,
    Dictionary<string, Guid>? Bindings = null, Dictionary<Guid, Guid>? EntityBindings = null, long? DefinitionVersion = null);

public static class Commands
{
    public static World NewWorld(CreateWorld input, string owner)
    {
        Guard.Require(input.Topology == "planar", "unsupported_topology", "This coordinate implementation supports explicit planar worlds. Spherical and wrapped worlds require their own transforms.");
        Guard.Require(!string.IsNullOrWhiteSpace(input.Name) && input.Width > 0 && input.Height > 0 &&
            double.IsFinite(input.Width) && double.IsFinite(input.Height), "invalid_world", "A world needs a name and finite positive dimensions in metres.");
        var id = Guid.NewGuid();
        var footprint = Spatial.Rectangle(0, 0, input.Width, input.Height);
        var world = new World
        {
            Id = id,
            Name = input.Name,
            Seed = input.Seed,
            Owner = owner,
            Reference = new($"VELLUM:{id}", footprint)
        };
        var area = new Area
        {
            Name = input.Name,
            Profile = Profile.World,
            Footprint = footprint,
            Frame = new(new(0, 0)),
            Traits = input.Traits ?? []
        };
        Refinement.ValidateTraits([], area.Traits);
        world.Areas.Add(area.Id, area);
        return world;
    }

    public static Proposal Preview(World source, Command command, string actor, IReadOnlyList<FieldData>? fields = null)
    {
        Guard.Require(command.OperationId != Guid.Empty, "missing_operation", "Every operation needs an idempotency ID.");
        Guard.Require(source.Version == command.ExpectedVersion, "version_conflict", "World changed; read the current version and preview again.");
        var world = AtlasJson.Clone(source);
        Constraints.Resolve(world);
        Dependencies.ValidateBindings(world);
        var impact = new Impact([], [], [], [], false);
        List<FieldData>? artifacts = null;
        switch (command.Kind)
        {
            case "createArea": AddArea(world, AtlasJson.Read<CreateArea>(command.Data), fields ?? [], impact); break;
            case "putFeature": PutFeature(world, AtlasJson.Read<EditFeature>(command.Data), actor, impact, fields ?? []); break;
            case "routeNetwork": PutFeature(world, NetworkAuthoring.Route(world, AtlasJson.Read<RouteNetwork>(command.Data), fields ?? []), actor, impact, fields ?? []); break;
            case "deleteFeature": DeleteFeature(world, command.Data, actor, impact); break;
            case "putLayer": PutLayer(world, AtlasJson.Read<Layer>(command.Data), impact); break;
            case "putEntity":
                PutEntity(world, AtlasJson.Read<Entity>(command.Data), impact);
                if (command.Data["origin"] is { } origin)
                {
                    var edit = AtlasJson.Read<EditFeature>(origin); var entityId = command.Data["id"]!.GetValue<Guid>();
                    if (edit.Feature.Id == Guid.Empty) edit.Feature.Id = world.Features.Values.FirstOrDefault(f => f.Kind == edit.Feature.Kind && f.Relations.Any(r => r.TargetId == entityId))?.Id ?? Topology.Identity(world.Id, $"entity-origin:{entityId}");
                    PutFeature(world, edit, actor, impact, fields ?? []);
                }
                break;
            case "setHumanEras":
                Guard.Require(!world.Generations.Any(g => g.Domains.Any(d => d is "cultural" or "political")), "fixed_history", "Completed human history is fixed. Configure eras before generating cultures or polities.");
                var eras = AtlasJson.Read<List<HumanEra>>(command.Data["eras"]!);
                Guard.Require(eras.Count > 0 && eras.Select(e => e.Id).Distinct().Count() == eras.Count && eras.All(e => !string.IsNullOrWhiteSpace(e.Id) && e.Years > 0 &&
                    double.IsFinite(e.Mobility) && e.Mobility >= 0 && double.IsFinite(e.PoliticalCapacity) && e.PoliticalCapacity > 0 &&
                    (e.PhysicalEpoch is null || world.Epochs.Any(p => p.Id == e.PhysicalEpoch))), "invalid_eras", "Human eras need distinct names, positive durations/capacity, nonnegative mobility and existing physical epoch references.");
                world.HumanEras = eras;
                break;
            case "setTraits": SetTraits(world, command.Data, impact); break;
            case "putMagic": MagicAuthoring.Put(world, AtlasJson.Read<MagicRule>(command.Data), impact); break;
            case "saveTemplate": Templates.Save(world, AtlasJson.Read<Template>(command.Data)); break;
            case "instantiateTemplate": Templates.Instantiate(world, AtlasJson.Read<Instantiate>(command.Data), actor, fields ?? [], impact); break;
            case "setView": SetView(world, AtlasJson.Read<MapView>(command.Data)); break;
            case "sculptField": artifacts = [FieldEdits.Sculpt(world, command, fields ?? [], impact, actor: actor)]; break;
            case "putLandform":
                var sculpt = new Sculpt(command.Data["areaId"]!.GetValue<Guid>(), "elevation", AtlasJson.Read<Position>(command.Data["center"]!),
                    command.Data["radius"]!.GetValue<double>(), command.Data["height"]!.GetValue<double>());
                var terrainCommand = command with { Data = JsonSerializer.SerializeToNode(sculpt, AtlasJson.Options)!.AsObject() };
                artifacts = [FieldEdits.Sculpt(world, terrainCommand, fields ?? [], impact, actor: actor)];
                PutFeature(world, new(sculpt.AreaId, new Feature
                {
                    Id = Topology.Identity(world.Id, $"landform:{command.OperationId}"),
                    Name = command.Data["name"]!.GetValue<string>(),
                    Kind = sculpt.Delta >= 0 ? "peak" : "depression",
                    LayerId = "geology",
                    AreaId = sculpt.AreaId,
                    Geometry = Spatial.Write(Spatial.Point(sculpt.Center)),
                    Attributes = new() { ["height"] = sculpt.Delta, ["radius"] = sculpt.Radius, ["fieldId"] = artifacts[0].Id.ToString() },
                    Causes = ["authored-terrain"]
                }), actor, impact, fields ?? []);
                break;
            case "createField": artifacts = [FieldEdits.Create(world, command, impact)]; break;
            case "connectSpaces": Networks.Connect(world, AtlasJson.Read<Connection>(command.Data), impact); break;
            case "reconcileBoundary": return Reconciliation.Preview(world, command.Data, actor, fields ?? [], command.OperationId);
            default: throw new DomainException("unknown_command", $"Unknown domain operation '{command.Kind}'.");
        }
        Constraints.Resolve(world);
        if (command.Kind == "connectSpaces" || impact.Features.Any(id => world.Features.GetValueOrDefault(id)?.Kind is "river" or "road" or "cave") || command.Kind == "deleteFeature")
            Topology.Rebuild(world);
        world.Version++;
        return new(world, impact, artifacts);
    }

    public static Area AddArea(World world, CreateArea input, IReadOnlyList<FieldData> fields, Impact impact)
    {
        Guard.Require(world.Areas.TryGetValue(input.ParentId, out var parent), "missing_parent", "Choose an existing geographic parent.");
        Guard.Require(input.Approach is "manual" or "procedural" or "blank", "invalid_approach", "Choose manual, blank or procedural creation.");
        Guard.Require(input.Context is "landscape" or "settlement" or "structure" or "cave", "invalid_context", "Choose a landscape, settlement, structure or cave context.");
        var layers = input.Domains.SelectMany(d => world.Layers.Values.Where(l => l.Generator == d || l.Id == d)).Select(l => l.Id).Distinct();
        var area = new Area
        {
            Id = input.Id ?? Guid.NewGuid(),
            ParentId = input.ParentId,
            Name = input.Name,
            Profile = input.Profile,
            Context = input.Context,
            ContextFeatureId = input.ContextFeatureId,
            Footprint = input.Footprint,
            Frame = input.Frame,
            LocalTraits = input.Traits ?? [],
            Traits = Constraints.Effective(world, parent!.Id).Concat(input.Traits ?? []).Distinct().ToList(),
            Layers = layers.ToDictionary(l => l, _ => input.Approach == "blank" ? Materialization.IntentionallyEmpty : Materialization.Unmaterialized)
        };
        Refinement.ValidateArea(world, area);
        if (area.ContextFeatureId is { } contextId)
            Guard.Require(world.Features.TryGetValue(contextId, out var contextFeature) && Composition.Visible(world, contextFeature, parent.Id) &&
                (Spatial.Read(contextFeature.Geometry).Dimension == NetTopologySuite.Geometries.Dimension.Surface ?
                    Composition.Geometry(world, contextFeature).Covers(Spatial.Read(area.Footprint)) : Spatial.Read(area.Footprint).Intersects(Composition.Geometry(world, contextFeature))),
                "area_context", "The mapped area must bind to an existing, spatially compatible parent feature.");
        area.Boundary = Refinement.Contract(world, area, fields);
        Refinement.ValidateBoundaryTraits(area);
        world.Areas.Add(area.Id, area);
        impact.Areas.Add(area.Id);
        if (input.CreateEntrance && (area.Profile == Profile.Interior || area.Context == "cave")) Networks.AddEntrance(world, area, "user", impact, fields);
        return area;
    }

    private static void PutFeature(World world, EditFeature input, string actor, Impact impact, IReadOnlyList<FieldData> fields)
    {
        Guard.Require(world.Areas.TryGetValue(input.AreaId, out var area), "missing_area", "The mapped area does not exist.");
        var feature = input.Feature;
        if (world.Features.TryGetValue(feature.Id, out var owned))
            Guard.Require(Composition.Space(world, owned.AreaId) == Composition.Space(world, area!.Id) &&
                Composition.Descendant(world, area.Id, owned.AreaId), "feature_scope",
                "Edit a feature in its owning geographic area or a compatible descendant space.");
        if (feature.Kind is "river" or "road" or "cave" && world.NetworkReaches.Count == 0) Topology.Rebuild(world);
        Guard.Require(world.Layers.TryGetValue(feature.LayerId, out var layer), "missing_layer", "The feature's layer must be registered in the world.");
        Guard.Require(layer!.Profiles.Contains(area!.Profile), "layer_profile", "This layer does not support this creation profile.");
        var shape = Spatial.Read(feature.Geometry);
        Guard.Require(Spatial.Read(area.Footprint).Covers(shape), "outside_area", "An ordinary edit must stay inside its mapped area.");
        ValidateAttributes(layer, feature.Attributes);
        foreach (var relation in feature.Relations)
            Guard.Require(world.Features.ContainsKey(relation.TargetId) || world.Entities.ContainsKey(relation.TargetId) || world.Areas.ContainsKey(relation.TargetId),
                "missing_relation", "Feature relationships must resolve within this world.");
        Hydrology.Prepare(world, area, feature, fields);
        Hydrology.ValidateLift(world, feature);
        Refinement.ValidateRiver(feature, feature.Geometry);
        foreach (var child in world.Areas.Values.Where(a => a.Id != area.Id && IsWithin(world, area.Id, a.Id)))
            Refinement.ValidateCrossings(child, feature, feature.Geometry);
        if (world.Features.TryGetValue(feature.Id, out var existing))
        {
            var local = existing.Detail.GetValueOrDefault(area.Id);
            Guard.Require(!actor.StartsWith("agent:", StringComparison.Ordinal) ||
                !existing.Protected && local?.Protected != true,
                "protected_feature", "Agent operations cannot overwrite protected authored features.");
            Guard.Require(feature.LayerId == existing.LayerId && feature.Kind == existing.Kind, "feature_identity", "Changing feature kind or layer requires an explicit replacement.");
            Refinement.ValidateCrossings(area, feature, feature.Geometry);
            existing.Name = feature.Name;
            existing.Relations = feature.Relations;
            if (existing.AreaId == area.Id)
            {
                existing.Geometry = feature.Geometry;
                existing.Attributes = feature.Attributes;
                existing.State = Materialization.Authored;
                existing.Protected = feature.Protected;
                existing.Actor = actor;
            }
            else
            {
                existing.Detail[area.Id] = new(feature.Geometry, Materialization.Authored, actor,
                    Attributes: AtlasJson.Clone(feature.Attributes), Protected: feature.Protected);
            }
        }
        else
        {
            Guard.Require(feature.Id != Guid.Empty, "feature_identity", "A feature needs a stable ID.");
            Refinement.ValidateCrossings(area, feature, feature.Geometry);
            feature.AreaId = area.Id;
            feature.Detail = [];
            feature.State = Materialization.Authored;
            feature.Actor = actor;
            feature.GenerationId = null;
            world.Features.Add(feature.Id, feature);
        }
        Dependencies.ValidateBindings(world);
        var affected = Dependencies.Affected(world, [feature.Id]);
        Topology.ValidateCurrent(world, affected);
        Topology.ValidateContracts(world, affected);
        foreach (var connection in world.Connections.Values) Networks.Validate(world, connection);
        area.Layers[feature.LayerId] = Materialization.Authored;
        area.Version++;
        impact.Features.AddRange(affected);
        impact.Areas.Add(area.Id);
        impact.Layers.Add(feature.LayerId);
        Invalidate(world, area, feature.LayerId, impact);
    }

    public static void Invalidate(World world, Area area, string layer, Impact impact)
    {
        var downstream = layer switch
        {
            "elevation" or "rivers" => new[] { "climate", "roads", "settlements", "cultures", "sovereignty" },
            "magic" => ["elevation", "climate", "rivers"],
            "cultures" => ["sovereignty", "administration"],
            _ => Array.Empty<string>()
        };
        foreach (var id in downstream.Where(area.Layers.ContainsKey))
        {
            if (area.Layers[id] is Materialization.Authored or Materialization.Protected or Materialization.IntentionallyEmpty) continue;
            area.Layers[id] = Materialization.Stale;
            impact.Invalidations.Add($"{area.Name}: {id}");
        }
        foreach (var child in world.Areas.Values.Where(a => a.ParentId == area.Id))
        {
            foreach (var id in child.Layers.Keys.ToList())
                if (child.Layers[id] is Materialization.Generated or Materialization.Stale) child.Layers[id] = Materialization.Stale;
            impact.Invalidations.Add($"{child.Name}: inherited inputs changed");
            Invalidate(world, child, layer, impact);
        }
    }

    private static void DeleteFeature(World world, JsonObject data, string actor, Impact impact)
    {
        var id = data["featureId"]!.GetValue<Guid>();
        Guard.Require(world.Features.TryGetValue(id, out var feature), "missing_feature", "The feature does not exist.");
        Guard.Require(!feature!.Protected || !actor.StartsWith("agent:", StringComparison.Ordinal), "protected_feature", "Agents cannot delete protected features.");
        Guard.Require(!world.Areas.Values.Any(a => a.Boundary?.Crossings.Any(c => c.FeatureId == id) == true),
            "locked_boundary", "This feature participates in boundary contracts; reconcile before deleting.");
        Guard.Require(!world.Features.Values.Any(f => f.Relations.Any(r => r.TargetId == id)) &&
            !world.Entities.Values.Any(e => e.Relations.Any(r => r.TargetId == id)), "referenced_feature", "Other features or entities depend on this feature.");
        Guard.Require(!world.Connections.Values.Any(c => c.A.FeatureId == id || c.B.FeatureId == id), "connected_feature", "Remove or reconcile network connections before deleting their entrance.");
        world.Features.Remove(id);
        var area = world.Areas[feature.AreaId];
        area.Version++;
        impact.Features.Add(id);
        impact.Areas.Add(area.Id);
        Invalidate(world, area, feature.LayerId, impact);
    }

    private static void PutLayer(World world, Layer layer, Impact impact)
    {
        Guard.Require(System.Text.RegularExpressions.Regex.IsMatch(layer.Id, "^[a-z][a-z0-9_-]*$") && layer.Profiles.Count > 0 &&
            layer.Representation is "vector" or "field" or "network", "invalid_layer", "Layers need an ID, representation and supported profiles.");
        Guard.Require(layer.Schema.All(item => item.Value is JsonObject spec && spec["type"]?.GetValue<string>() is "string" or "number" or "boolean"),
            "invalid_schema", "Attribute schemas support string, number and boolean types.");
        Guard.Require(layer.Representation != "field" || !new[] { "temperature", "moisture", "rainfall", "ice", "rock", "fracture", "erosion", "glacialHistory", "flow", "water" }.Contains(layer.Id),
            "reserved_channel", "Choose a custom field ID distinct from physical channel names.");
        if (world.Layers.TryGetValue(layer.Id, out var previous))
        {
            Guard.Require(previous.Representation == layer.Representation || !world.Features.Values.Any(f => f.LayerId == layer.Id) && !world.Fields.Any(f => f.LayerId == layer.Id),
                "layer_representation", "A materialized layer must retain its representation type.");
            foreach (var feature in world.Features.Values.Where(f => f.LayerId == layer.Id))
            {
                Guard.Require(layer.Profiles.Contains(world.Areas[feature.AreaId].Profile), "layer_profile", "Existing feature profiles must remain supported.");
                ValidateAttributes(layer, feature.Attributes);
                foreach (var detail in feature.Detail.Values) ValidateAttributes(layer, new JsonObject(feature.Attributes.Concat(detail.Attributes ?? []).GroupBy(p => p.Key).Select(g => new KeyValuePair<string, JsonNode?>(g.Key, g.Last().Value?.DeepClone()))));
            }
        }
        world.Layers[layer.Id] = layer;
        impact.Layers.Add(layer.Id);
    }

    private static void PutEntity(World world, Entity entity, Impact impact)
    {
        Guard.Require(entity.Id != Guid.Empty && !string.IsNullOrWhiteSpace(entity.Kind), "invalid_entity", "Entities need a stable ID and kind.");
        Guard.Require(!world.Entities.TryGetValue(entity.Id, out var previous) || previous.Kind == entity.Kind, "entity_identity", "An existing entity retains its domain kind.");
        Guard.Require(entity.Relations.All(r => r.TargetId == entity.Id || world.Entities.ContainsKey(r.TargetId) ||
            world.Features.ContainsKey(r.TargetId) || world.Areas.ContainsKey(r.TargetId)), "missing_relation", "Entity relationships must resolve within this world.");
        if (entity.Attributes["initialPopulation"] is { } initial)
            Guard.Require(initial is JsonValue value && value.TryGetValue<double>(out var count) && double.IsFinite(count) && count >= 0,
                "initial_population", "Initial population must be a finite nonnegative number.");
        world.Entities[entity.Id] = entity with { State = Materialization.Authored };
        var derived = entity.Kind switch
        {
            "culture" or "language" or "religion" => new[] { "cultures", "languages", "religions", "settlements", "sovereignty", "claims", "control", "administration", "roads", "structures" },
            "polity" => ["sovereignty", "claims", "control", "administration", "settlements", "roads"],
            "community" or "settlement" or "institution" => ["settlements", "roads", "structures", "administration"],
            _ => Array.Empty<string>()
        };
        foreach (var area in world.Areas.Values)
        {
            var stale = derived.Where(layer => area.Layers.GetValueOrDefault(layer) == Materialization.Generated).ToList();
            if (stale.Count == 0) continue;
            foreach (var layer in stale) { area.Layers[layer] = Materialization.Stale; impact.Layers.Add(layer); }
            area.Version++; impact.Areas.Add(area.Id); impact.Invalidations.Add($"{area.Name}: {entity.Name} changed human geography inputs");
        }
    }

    private static void SetTraits(World world, JsonObject data, Impact impact)
    {
        var area = world.Areas[data["areaId"]!.GetValue<Guid>()];
        var traits = AtlasJson.Read<List<Trait>>(data["traits"]!);
        var inherited = area.ParentId is { } id ? Constraints.Effective(world, id) : [];
        Refinement.ValidateTraits(inherited, traits);
        area.LocalTraits = traits;
        area.Traits = inherited.Concat(traits).Distinct().ToList();
        Constraints.Resolve(world);
        Refinement.ValidateBoundaryTraits(area);
        foreach (var child in world.Areas.Values.Where(a => a.Id != area.Id && Composition.Descendant(world, a.Id, area.Id)))
            Refinement.ValidateBoundaryTraits(child);
        area.Version++;
        impact.Areas.Add(area.Id);
        Invalidate(world, area, "elevation", impact);
    }

    private static void SetView(World world, MapView view)
    {
        Guard.Require(world.Areas.ContainsKey(view.AreaId) && view.Layers.All(l => world.Layers.ContainsKey(l.LayerId) && l.Opacity is >= 0 and <= 1 &&
            double.IsFinite(l.MinScale) && l.MinScale >= 0 && System.Text.RegularExpressions.Regex.IsMatch(l.Color, "^#[0-9a-fA-F]{6}$")),
            "invalid_view", "Views need a located area, registered layers and valid opacities.");
        world.Views.RemoveAll(v => v.Id == view.Id);
        world.Views.Add(view);
    }

    private static bool IsWithin(World world, Guid ancestor, Guid child)
    {
        for (var id = world.Areas[child].ParentId; id is { } parent; id = world.Areas[parent].ParentId)
            if (parent == ancestor) return true;
        return false;
    }

    public static void ValidateAttributes(Layer layer, JsonObject attributes)
    {
        foreach (var (key, definition) in layer.Schema)
        {
            var spec = definition!.AsObject();
            var value = attributes[key];
            Guard.Require(spec["required"]?.GetValue<bool>() != true || value is not null,
                "missing_attribute", $"Required layer attribute '{key}' is missing.");
            if (value is null) continue;
            var type = spec["type"]?.GetValue<string>() ?? "string";
            var element = JsonSerializer.SerializeToElement(value);
            Guard.Require(type switch
            {
                "number" => element.ValueKind == JsonValueKind.Number,
                "boolean" => element.ValueKind is JsonValueKind.True or JsonValueKind.False,
                _ => element.ValueKind == JsonValueKind.String
            }, "attribute_type", $"Attribute '{key}' must be {type}.");
        }
    }
}
