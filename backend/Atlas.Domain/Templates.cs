using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Distance;
using System.Text.Json.Nodes;

namespace Atlas.Domain;

public static class Templates
{
    public static void ValidateDefinition(Template template, World? world = null)
    {
        Guard.Require(template.Id != Guid.Empty && template.Version > 0 && !string.IsNullOrWhiteSpace(template.Name) && template.ParentProfiles.Count > 0 &&
            template.ParentProfiles.All(p => p < template.Profile), "template_context", "Templates need an ID, name and compatible coarser parents.");
        template.Frame.Validate(); var footprint = Spatial.Read(template.Footprint);
        Guard.Require(template.Context is "landscape" or "settlement" or "structure" or "cave", "template_context", "Choose a landscape, settlement, structure or cave template context.");
        Guard.Require(template.Units is "metre" or "foot" or "custom" && (template.Units != "metre" || Math.Abs(template.Frame.MetresPerUnit - 1) < 1e-9) &&
            (template.Units != "foot" || Math.Abs(template.Frame.MetresPerUnit - .3048) < 1e-9), "template_units", "Template units must agree with the definition frame's metre scale.");
        var layers = (world?.Layers ?? BuiltinLayers.Create()).ToDictionary(v => v.Key, v => v.Value);
        foreach (var layer in template.Layers ?? []) layers[layer.Id] = layer;
        Guard.Require(template.Features.Select(f => f.Id).Concat((template.Entities ?? []).Select(e => e.Id)).Distinct().Count() == template.Features.Count + (template.Entities?.Count ?? 0),
            "template_identity", "Local features and entities need distinct identities.");
        var features = template.Features.ToDictionary(f => f.Id); var entities = (template.Entities ?? []).ToDictionary(e => e.Id);
        var spaces = (template.Spaces ?? []).ToDictionary(s => s.Id);
        foreach (var space in spaces.Values) { space.Frame.Validate(); Spatial.Read(space.Footprint); }
        foreach (var feature in template.Features)
        {
            var scope = feature.AreaId == Guid.Empty ? footprint : spaces.TryGetValue(feature.AreaId, out var space) ? Spatial.Read(space.Footprint) : null;
            Guard.Require(scope is not null && scope.Covers(Spatial.Read(feature.Geometry)) && layers.TryGetValue(feature.LayerId, out var layer) && layer.Profiles.Contains(feature.AreaId == Guid.Empty ? template.Profile : Profile.Interior),
                "template_geometry", "Template features must lie in their declared local space and use compatible layers.");
            Guard.Require(feature.Relations.All(r => features.ContainsKey(r.TargetId) || entities.ContainsKey(r.TargetId) || world?.Entities.ContainsKey(r.TargetId) == true),
                "template_relation", "Template relations must resolve to local features/entities or declared world context.");
            Commands.ValidateAttributes(layers[feature.LayerId], feature.Attributes);
        }
        foreach (var entity in entities.Values)
            Guard.Require(entity.Relations.All(r => features.ContainsKey(r.TargetId) || entities.ContainsKey(r.TargetId)), "template_relation", "Local entity relations must resolve within the definition.");
        var sockets = template.Sockets ?? [];
        Guard.Require(sockets.Select(s => s.Id).Distinct().Count() == sockets.Count, "template_socket", "Access sockets need distinct names.");
        foreach (var socket in sockets)
            Guard.Require(features.TryGetValue(socket.FeatureId, out var feature) && feature.AreaId == (socket.SpaceId ?? Guid.Empty) &&
                Spatial.Read(feature.Geometry).Distance(Spatial.Point(socket.Position)) <= 1e-5 && socket.Kind is "entrance" or "vertical" or "road" or "cave" or "portal" &&
                (socket.ConnectsTo is null || sockets.Any(s => s.Id == socket.ConnectsTo && s.Id != socket.Id)),
                "template_socket", "Sockets must attach to local doors, passages or access features and resolve their internal peer.");
        foreach (var space in spaces.Values)
            Guard.Require(sockets.Any(s => s.SpaceId == space.Id), "template_space_access", "Each additional floor or space needs a declared stair, entrance or portal socket.");
        if (template.Recipe is { } recipe)
            Guard.Require(recipe.Domains.Count > 0 && recipe.Domains.All(d => d is "physical" or "magic" or "cultural" or "political" or "built") &&
                recipe.Quality is "draft" or "standard" or "fine", "template_recipe", "Use registered generation domains and a supported quality.");
        Refinement.ValidateTraits([], template.Traits);
    }

    public static void Save(World world, Template template) { ValidateDefinition(template, world); world.Templates[template.Id] = AtlasJson.Clone(template); }

    public static LocalFrame Compose(LocalFrame definition, LocalFrame placement) => new(placement.ToWorld(definition.Origin),
        definition.Rotation + placement.Rotation, definition.MetresPerUnit * placement.MetresPerUnit, placement.Floor ?? definition.Floor);

    public static void Instantiate(World world, Instantiate input, string actor, IReadOnlyList<FieldData> fields, Impact impact)
    {
        Guard.Require(world.Templates.TryGetValue(input.TemplateId, out var definition), "missing_template", "The template does not exist.");
        var template = definition!; ValidateDefinition(template, world);
        Guard.Require(input.DefinitionVersion is null || input.DefinitionVersion == template.Version, "version_conflict", "Reload the selected template definition before placing it.");
        Guard.Require(world.Areas.TryGetValue(input.ParentId, out var parent) && template.ParentProfiles.Contains(parent.Profile) && world.Reference.Units == "metre",
            "template_context", "Choose a compatible geographic parent in the declared metric world.");
        var frame = Compose(template.Frame, input.Frame); var footprint = Spatial.Transform(template.Footprint, frame);
        Admit(world, parent!, template, input.ContextFeatureId, footprint, fields);
        foreach (var layer in template.Layers ?? [])
        {
            if (world.Layers.TryGetValue(layer.Id, out var current))
                Guard.Require(current.Representation == layer.Representation && JsonNode.DeepEquals(current.Schema, layer.Schema), "template_layer", "A template layer conflicts with the target world's attribute schema.");
            else world.Layers.Add(layer.Id, AtlasJson.Clone(layer));
        }
        var traits = template.Traits.Select(t => t with { Scope = t.Scope is null ? null : Spatial.Transform(t.Scope, frame) }).ToList();
        var root = Commands.AddArea(world, new(input.ParentId, input.Name, template.Profile, footprint, frame, "manual", [], traits,
            Context: template.Context, ContextFeatureId: input.ContextFeatureId, CreateEntrance: false), fields, impact);
        root.TemplateId = template.Id; root.TemplateInstanceId = root.Id; root.Recipe = template.Recipe;
        var areas = new Dictionary<Guid, Area> { [Guid.Empty] = root }; var frames = new Dictionary<Guid, LocalFrame> { [Guid.Empty] = frame };
        foreach (var space in template.Spaces ?? [])
        {
            var located = Compose(space.Frame, frame) with { Floor = space.Frame.Floor ?? frame.Floor }; frames[space.Id] = located;
            var container = root.Profile < Profile.Interior ? root : parent!;
            var spaceFootprint = Spatial.Transform(space.Footprint, located);
            Admit(world, container, template, input.ContextFeatureId, spaceFootprint, fields);
            var mapped = Commands.AddArea(world, new(container.Id, space.Name, Profile.Interior, spaceFootprint, located,
                "manual", [], Context: "structure", ContextFeatureId: input.ContextFeatureId, CreateEntrance: false), fields, impact);
            mapped.TemplateId = template.Id; mapped.TemplateInstanceId = root.Id; mapped.Recipe = template.Recipe;
            areas[space.Id] = mapped;
        }
        var identities = template.Features.Select(f => f.Id).Concat((template.Entities ?? []).Select(e => e.Id)).ToDictionary(id => id, _ => Guid.NewGuid());
        foreach (var (id, target) in input.EntityBindings ?? [])
        {
            Guard.Require((template.Entities ?? []).Any(e => e.Id == id && world.Entities.TryGetValue(target, out var existing) && e.Kind == existing.Kind), "template_entity", "Entity bindings need a declared local entity and a compatible target entity.");
            identities[id] = target;
        }
        foreach (var entity in template.Entities ?? [])
        {
            if (world.Entities.ContainsKey(identities[entity.Id])) continue;
            var attributes = AtlasJson.Clone(entity.Attributes); Remap(attributes, identities);
            if (attributes["center"] is { } center) attributes["center"] = System.Text.Json.JsonSerializer.SerializeToNode(frame.ToWorld(AtlasJson.Read<Position>(center)), AtlasJson.Options);
            world.Entities.Add(identities[entity.Id], entity with { Id = identities[entity.Id], Attributes = attributes, Relations = entity.Relations.Select(r => new Relation(identities.GetValueOrDefault(r.TargetId, r.TargetId), r.Kind)).ToList(), State = Materialization.Authored });
        }
        foreach (var source in template.Features)
        {
            var area = areas[source.AreaId]; var transform = frames[source.AreaId]; var feature = AtlasJson.Clone(source);
            feature.Id = identities[source.Id]; feature.AreaId = area.Id; feature.Geometry = Spatial.Transform(source.Geometry, transform); feature.Detail = [];
            feature.State = Materialization.Authored; feature.Protected = true; feature.Actor = actor; feature.GenerationDomain = null;
            feature.Relations = source.Relations.Select(r => new Relation(identities.GetValueOrDefault(r.TargetId, r.TargetId), r.Kind)).ToList();
            Remap(feature.Attributes, identities); feature.Causes.Add($"template:{template.Id}:v{template.Version}");
            feature.Attributes["elevation"] = transform.Origin.Z + (source.Attributes["elevation"]?.GetValue<double>() ?? 0) * transform.MetresPerUnit;
            feature.Attributes["floor"] = transform.Floor;
            world.Features.Add(feature.Id, feature); area.Layers[feature.LayerId] = Materialization.Authored; impact.Features.Add(feature.Id);
        }
        var sockets = template.Sockets ?? [];
        var endpoints = new Dictionary<string, ConnectionEnd>();
        foreach (var socket in sockets)
        {
            var local = socket.SpaceId ?? Guid.Empty; var position = frames[local].ToWorld(socket.Position);
            endpoints[socket.Id] = new(areas[local].Id, position, identities[socket.FeatureId]);
        }
        foreach (var socket in sockets)
        {
            var end = endpoints[socket.Id];
            if (socket.ConnectsTo is { } peer)
            {
                if (world.Connections.Values.Any(c => c.A == endpoints[peer] && c.B == end)) continue;
                Networks.Connect(world, new(Guid.NewGuid(), socket.Kind, end, endpoints[peer]), impact); continue;
            }
            if (input.Bindings?.TryGetValue(socket.Id, out var targetId) != true)
            {
                Guard.Require(!socket.Required, "template_binding", $"Bind the required '{socket.Id}' socket to a located access feature."); continue;
            }
            var target = world.Features.GetValueOrDefault(targetId);
            Guard.Require(target is not null && (socket.TargetKinds is null || socket.TargetKinds.Contains(target.Kind)), "template_binding", "The access target has an incompatible feature kind.");
            if (template.Requirements?.StreetAccess == true && socket.Required)
                Guard.Require(Networks.ReachesRoad(world, targetId), "template_street", "The bound access feature must connect to an actual road or street.");
            var geometry = Composition.Geometry(world, target!); var closest = DistanceOp.NearestPoints(geometry, Spatial.Point(end.Position))[0];
            Guard.Require(socket.Kind == "portal" || geometry.Distance(Spatial.Point(end.Position)) <= 1e-5, "template_alignment", $"The '{socket.Id}' socket must meet its target geometry. Adjust placement or its frame.");
            var position = new Position(closest.X, closest.Y, target!.Attributes["elevation"]?.GetValue<double>() ?? world.Areas[target.AreaId].Frame.Origin.Z);
            Networks.Connect(world, new(Guid.NewGuid(), socket.Kind == "entrance" && Math.Abs(position.Z - end.Position.Z) > 1e-5 ? "vertical" : socket.Kind,
                new(target.AreaId, position, target.Id), end), impact);
        }
        var instanceAreas = areas.Values.Select(a => a.Id).ToHashSet();
        if (Composition.IsSpace(root) && !world.Connections.Values.Any(c => c.A.AreaId == root.Id && !instanceAreas.Contains(c.B.AreaId) || c.B.AreaId == root.Id && !instanceAreas.Contains(c.A.AreaId)))
        {
            var declared = sockets.FirstOrDefault(s => s.SpaceId is null && s.ConnectsTo is null);
            if (declared is not null)
            {
                var endpoint = endpoints[declared.Id];
                Networks.Connect(world, new(Guid.NewGuid(), Math.Abs(endpoint.Position.Z - parent!.Frame.Origin.Z) > 1e-5 ? "vertical" : "entrance",
                    new(parent.Id, endpoint.Position with { Z = parent.Frame.Origin.Z }), endpoint), impact);
            }
            else
            {
                var content = template.Features.Where(f => f.AreaId == Guid.Empty && f.Kind is "door" or "stairs" or "room").OrderBy(f => f.Kind == "door" ? 0 : f.Kind == "stairs" ? 1 : 2).FirstOrDefault();
                var point = content is null ? Spatial.Read(root.Footprint).InteriorPoint.Coordinate : Spatial.Read(world.Features[identities[content.Id]].Geometry).InteriorPoint.Coordinate;
                var position = new Position(point.X, point.Y, root.Frame.Origin.Z);
                var entrance = new Feature
                {
                    Name = $"{root.Name} access",
                    Kind = "entrance",
                    LayerId = "structures",
                    AreaId = root.Id,
                    Geometry = Spatial.Write(Spatial.Point(position)),
                    Actor = actor,
                    Attributes = new() { ["elevation"] = position.Z, ["floor"] = frame.Floor, ["access"] = "surface-shaft" }
                };
                world.Features.Add(entrance.Id, entrance); impact.Features.Add(entrance.Id);
                Networks.Connect(world, new(Guid.NewGuid(), Math.Abs(position.Z - parent!.Frame.Origin.Z) > 1e-5 ? "vertical" : "entrance", new(parent.Id, position with { Z = parent.Frame.Origin.Z }), new(root.Id, position, entrance.Id)), impact);
            }
        }
        foreach (var area in areas.Values)
            if (area.Boundary is { } boundary) area.Boundary = boundary with { ParentVersion = world.Areas[area.ParentId!.Value].Version };
    }

    private static void Admit(World world, Area parent, Template template, Guid? contextId, JsonObject footprint, IReadOnlyList<FieldData> fields)
    {
        var shape = Spatial.Read(footprint); var requirements = template.Requirements;
        if (requirements?.ContextKinds is { Count: > 0 } kinds)
            Guard.Require(contextId is { } id && world.Features.TryGetValue(id, out var feature) && kinds.Contains(feature.Kind) && Composition.Visible(world, feature, parent.Id) && Composition.Geometry(world, feature).Covers(shape),
                "template_context", "Place this template inside a compatible located structure or geological feature.");
        foreach (var trait in requirements?.Fields ?? [])
        {
            var coverage = 0d;
            foreach (var field in fields.Where(f => f.Values.ContainsKey(trait.Field) && Composition.Space(world, f.AreaId) == Composition.Space(world, parent.Id)))
            {
                var scope = FieldComposition.CoverageGeometry(world, field, trait.Field).Intersection(shape);
                if (scope.IsEmpty) continue;
                var values = FieldLimits.Extrema(field, trait.Field, scope).ToList();
                Guard.Require(values.All(v => v >= trait.Minimum && v <= trait.Maximum), "template_terrain", $"The target's {trait.Field} is outside the template's context requirements."); coverage += scope.Area;
            }
            Guard.Require(coverage >= shape.Area - 1e-5, "template_terrain", $"Materialize the target's {trait.Field} before placing this template.");
        }
        if (requirements?.MaximumSlope is { } maximum)
        {
            var samples = fields.Where(f => f.Values.ContainsKey("elevation")).SelectMany(f => Enumerable.Range(0, f.Width * f.Height).Select(i => (Field: f, Point: f.PositionAt(i % f.Width, i / f.Width))))
                .Where(s => shape.Covers(Spatial.Point(s.Point))).ToList();
            Guard.Require(samples.Count > 0 && samples.All(s =>
            {
                var dx = (s.Field.Bounds[2] - s.Field.Bounds[0]) / (s.Field.Width - 1); var dy = (s.Field.Bounds[3] - s.Field.Bounds[1]) / (s.Field.Height - 1);
                var z = s.Field.Sample("elevation", s.Point);
                return Math.Abs(s.Field.Sample("elevation", s.Point with { X = s.Point.X + dx }) - z) / dx <= maximum && Math.Abs(s.Field.Sample("elevation", s.Point with { Y = s.Point.Y + dy }) - z) / dy <= maximum;
            }), "template_slope", "The target terrain is too steep or lacks sampled relief for this template.");
        }
        if (requirements?.StreetAccess == true)
            Guard.Require((template.Sockets ?? []).Any(s => s.Required && s.ConnectsTo is null), "template_access", "A street-connected template must declare a required external door or access socket.");
    }

    private static void Remap(JsonNode node, Dictionary<Guid, Guid> identities)
    {
        if (node is JsonObject obj)
            foreach (var key in obj.Select(p => p.Key).ToList())
                if (obj[key] is JsonValue value && value.TryGetValue<string>(out var text) && Guid.TryParse(text, out var id) && identities.TryGetValue(id, out var target)) obj[key] = target.ToString();
                else if (obj[key] is { } child) Remap(child, identities);
                else if (node is JsonArray array) foreach (var item in array.OfType<JsonNode>()) Remap(item, identities);
    }
}
