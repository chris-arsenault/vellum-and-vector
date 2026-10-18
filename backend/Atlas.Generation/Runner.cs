using Atlas.Domain;

namespace Atlas.Generation;

public static class Runner
{
    public static async Task<GenerationOutput> Run(GenerationInput input, Guid jobId,
        Func<string, double, Task> stage, CancellationToken cancellation)
    {
        input = input with { World = AtlasJson.Clone(input.World) };
        Constraints.Resolve(input.World);
        var contracts = Registry.Validate(input.World, input.Request);
        var features = new List<Feature>();
        var entities = new List<Entity>();
        var fields = new List<FieldData>();
        var connections = new List<Connection>();
        var warnings = new List<string>();
        var area = input.World.Areas[input.Request.AreaId];
        var physical = input.Fields.Where(f => Registry.IsAncestor(input.World, f.AreaId, area.Id) && f.Values.ContainsKey("elevation"))
            .OrderBy(f => input.World.Areas[f.AreaId].Profile).LastOrDefault();
        if (physical is not null && physical.AreaId != area.Id) physical = ScopeField(physical, area, input.Request.Quality);
        foreach (var contract in contracts)
        {
            var featureStart = features.Count;
            cancellation.ThrowIfCancellationRequested();
            await stage($"{contract.Id}: preparing", 0.05);
            switch (contract.Id)
            {
                case "physical":
                    if ((area.Layers.GetValueOrDefault("elevation") == Materialization.Protected ||
                        area.Layers.GetValueOrDefault("elevation") == Materialization.Authored && physical?.Authored is null) && physical is not null)
                    {
                        warnings.Add("Authored physical fields were retained. Generate child detail to refine their unprotected surroundings.");
                        features.AddRange(input.World.Features.Values.Where(f => f.AreaId == area.Id && f.Kind == "river").Select(AtlasJson.Clone));
                        break;
                    }
                    var generated = await Physical.Generate(input, jobId, stage, cancellation);
                    physical = generated.Field;
                    fields.Add(physical);
                    features.AddRange(generated.Rivers);
                    break;
                case "magic":
                    if (!contracts.Any(c => c.Id == "physical"))
                    {
                        var response = await BoundedRefinement.Generate(input, jobId, stage, cancellation, presentOnly: true);
                        physical = response.Field; fields.Add(physical); features.AddRange(response.Rivers);
                    }
                    var magic = Magic.Field(input.World, area, physical!, jobId);
                    fields.Add(magic);
                    break;
                case "cultural":
                    var culture = HumanGeography.Culture(input, jobId, physical!);
                    fields.Add(culture.Field);
                    entities.AddRange(culture.Entities);
                    features.AddRange(culture.Sites);
                    break;
                case "political":
                    var politics = HumanGeography.Politics(input, jobId, physical!);
                    entities.AddRange(politics.Entities);
                    features.AddRange(politics.Features);
                    fields.Add(politics.Field);
                    break;
                case "built":
                    var built = BuiltEnvironment.Generate(input, jobId, physical);
                    features.AddRange(built.Features); entities.AddRange(built.Entities); connections.AddRange(built.Connections);
                    break;
            }
            foreach (var feature in features.Skip(featureStart)) feature.GenerationDomain = contract.Id;
            // Later domains see the completed private stage, while publication remains atomic.
            foreach (var feature in features)
                if (input.World.Features.TryGetValue(feature.Id, out var previousFeature) && previousFeature.AreaId != area.Id)
                    previousFeature.Detail[area.Id] = new(feature.Geometry, Materialization.Generated, "generator", jobId, AtlasJson.Clone(feature.Attributes));
                else input.World.Features[feature.Id] = AtlasJson.Clone(feature);
            foreach (var entity in entities) input.World.Entities[entity.Id] = AtlasJson.Clone(entity);
            foreach (var field in fields)
            {
                input.World.Fields.RemoveAll(f => f.AreaId == field.AreaId && f.LayerId == FieldLayer(field));
                input.World.Fields.Add(new(field.Id, field.AreaId, FieldLayer(field),
                    field.Algorithm, jobId, field.Width * field.Height, field.Values.Keys.ToList()));
            }
            input = input with { Fields = input.Fields.Where(f => !fields.Any(n => n.AreaId == f.AreaId && FieldLayer(n) == FieldLayer(f))).Concat(fields).DistinctBy(f => f.Id).ToList() };
        }
        await stage("Validating spatial contracts and protected-content merge", 0.95);
        cancellation.ThrowIfCancellationRequested();
        foreach (var field in fields) field.Validate();
        return new(features, entities, fields, contracts.SelectMany(c => c.Produces).Distinct().ToList(), warnings,
            fields.Any(f => f.Values.ContainsKey("elevation")) ? fields.SelectMany(f => f.Transfers ?? []).ToList() : null, connections);
    }

    private static string FieldLayer(FieldData field) => field.Values.ContainsKey("elevation") ? "elevation" : field.Values.ContainsKey("population") ? "cultures" : field.Values.Keys.Any(k => k.StartsWith("reach:", StringComparison.Ordinal)) ? "sovereignty" : "magic";

    public static FieldData ScopeField(FieldData source, Area area, string quality)
        => FieldComposition.Resample(source, area, Registry.Resolution(quality));

    public static World Merge(World current, GenerationInput input, GenerationOutput output, Guid jobId)
    {
        var world = AtlasJson.Clone(current);
        Constraints.Resolve(world);
        var area = world.Areas[input.Request.AreaId];
        var original = input.World.Areas[area.Id];
        var shape = Spatial.Read(area.Footprint);
        var influence = shape.Buffer(Math.Max(shape.EnvelopeInternal.Width, shape.EnvelopeInternal.Height) /
            (Registry.Resolution(input.Request.Quality) - 1) * RegionalGrid.Halo);
        List<Guid> InfluenceFields(World source) => source.Fields.Where(f =>
            Composition.Space(source, f.AreaId) == Composition.Space(source, area.Id) &&
            Spatial.Read(source.Areas[f.AreaId].Footprint).Intersects(influence)).Select(f => f.Id).Order().ToList();
        Guard.Require(InfluenceFields(input.World).SequenceEqual(InfluenceFields(world)), "generation_conflict",
            "A field used by this area's solve or neighboring influence halo changed during generation.");
        if (input.Request.Domains.Contains("physical"))
            foreach (var source in input.World.Features.Values.Where(f => f.Kind is "river" or "lake" or "ocean" && Composition.Visible(input.World, f, area.Id) && Composition.Geometry(input.World, f).Intersects(influence)))
                Guard.Require(world.Features.TryGetValue(source.Id, out var currentFeature) &&
                    System.Text.Json.JsonSerializer.Serialize(source, AtlasJson.Options) == System.Text.Json.JsonSerializer.Serialize(currentFeature, AtlasJson.Options),
                    "generation_conflict", "A maintained waterway or receiving water body used by the physical solve changed during generation.");
        List<MagicRule> Relevant(World source) => source.Magic.Where(rule =>
            shape.Distance(Spatial.Point(rule.Source)) < rule.Radius).OrderBy(rule => rule.Id).ToList();
        Guard.Require(input.World.Epochs.SequenceEqual(world.Epochs) &&
            System.Text.Json.JsonSerializer.Serialize(Relevant(input.World), AtlasJson.Options) == System.Text.Json.JsonSerializer.Serialize(Relevant(world), AtlasJson.Options),
            "generation_conflict", "Historical or magical inputs changed while this job was running.");
        Guard.Require(area.Boundary?.Version == original.Boundary?.Version, "generation_conflict", "Boundary contracts changed during generation; retry against the new contract.");
        Guard.Require(System.Text.Json.JsonSerializer.Serialize(area.Traits, AtlasJson.Options) == System.Text.Json.JsonSerializer.Serialize(original.Traits, AtlasJson.Options) && area.Context == original.Context,
            "generation_conflict", "Generation traits or context changed while the worker was running.");
        foreach (var ancestor in input.World.Areas.Values.Where(a => a.Id != area.Id && Registry.IsAncestor(input.World, a.Id, area.Id)))
        {
            var oldFields = input.World.Fields.Where(f => f.AreaId == ancestor.Id).Select(f => f.Id).Order().ToList();
            var newFields = world.Fields.Where(f => f.AreaId == ancestor.Id).Select(f => f.Id).Order().ToList();
            Guard.Require(oldFields.SequenceEqual(newFields) &&
                System.Text.Json.JsonSerializer.Serialize(ancestor.Traits, AtlasJson.Options) == System.Text.Json.JsonSerializer.Serialize(world.Areas[ancestor.Id].Traits, AtlasJson.Options),
                "generation_conflict", "Inherited fields or traits changed during generation.");
        }
        foreach (var entity in output.Entities)
            if (!world.Entities.TryGetValue(entity.Id, out var previousEntity) || previousEntity.State == Materialization.Generated &&
                input.World.Entities.TryGetValue(entity.Id, out var inputEntity) &&
                System.Text.Json.JsonSerializer.Serialize(previousEntity, AtlasJson.Options) == System.Text.Json.JsonSerializer.Serialize(inputEntity, AtlasJson.Options))
                world.Entities[entity.Id] = entity;
        var generatedIds = output.Features.Select(f => f.Id).ToHashSet();
        foreach (var feature in world.Features.Values.Where(f => output.Layers.Contains(f.LayerId) &&
            (f.GenerationDomain is { } domain ? input.Request.Domains.Contains(domain) || domain is "physical" or "magic" && input.Request.Domains.Any(d => d is "physical" or "magic") :
                f.Kind is "community" or "culturalOrigin" or "institution" ? input.Request.Domains.Contains("cultural") : f.Kind == "capital" ? input.Request.Domains.Contains("political") : true)).ToList())
        {
            if (feature.Protected || feature.State is Materialization.Authored or Materialization.Protected) continue;
            if (feature.AreaId == area.Id && !generatedIds.Contains(feature.Id) &&
                !world.Areas.Values.Any(a => a.Boundary?.Crossings.Any(c => c.FeatureId == feature.Id) == true)) world.Features.Remove(feature.Id);
            if (feature.Detail.TryGetValue(area.Id, out var detail) && detail.State == Materialization.Generated && !generatedIds.Contains(feature.Id))
                feature.Detail.Remove(area.Id);
        }
        foreach (var candidate in output.Features)
        {
            Spatial.Read(candidate.Geometry);
            foreach (var child in world.Areas.Values.Where(a => a.Id != area.Id && Registry.IsAncestor(world, area.Id, a.Id)))
                Refinement.ValidateCrossings(child, candidate, candidate.Geometry);
            if (world.Features.TryGetValue(candidate.Id, out var existing))
            {
                if (existing.AreaId == area.Id && (existing.Protected || existing.State is Materialization.Authored or Materialization.Protected)) continue;
                if (existing.Detail.TryGetValue(area.Id, out var detail) && detail.State != Materialization.Generated) continue;
                Refinement.ValidateCrossings(area, candidate, candidate.Geometry);
                if (existing.AreaId == area.Id)
                {
                    existing.Geometry = candidate.Geometry;
                    existing.Attributes = candidate.Attributes;
                    existing.GenerationId = jobId;
                    existing.Causes = candidate.Causes;
                }
                else existing.Detail[area.Id] = new(candidate.Geometry, Materialization.Generated, "generator", jobId, Hydrology.GeometricAttributes(candidate.Attributes));
            }
            else
            {
                Refinement.ValidateCrossings(area, candidate, candidate.Geometry);
                world.Features.Add(candidate.Id, candidate);
            }
        }
        foreach (var field in output.Fields)
        {
            var layer = FieldLayer(field);
            if (area.Layers.GetValueOrDefault(layer) == Materialization.Protected ||
                area.Layers.GetValueOrDefault(layer) == Materialization.Authored && field.Authored is null) continue;
            foreach (var child in world.Areas.Values.Where(a => a.Id != area.Id && Registry.IsAncestor(world, area.Id, a.Id)))
                foreach (var sample in child.Boundary?.Samples ?? [])
                    foreach (var channel in sample.Values.Keys.Where(field.Values.ContainsKey))
                    {
                        var old = input.Fields.LastOrDefault(f => f.AreaId == field.AreaId && f.Values.ContainsKey(channel));
                        if (old is null) continue;
                        Guard.Require(Math.Abs(field.Sample(channel, sample.Point) - old.Sample(channel, sample.Point)) <= 1e-6,
                            "locked_field_boundary", "Generation would change a descendant's fixed environmental edge. Reconcile that boundary before replacing its parent field.");
                    }
            world.Fields.RemoveAll(f => f.AreaId == area.Id && f.LayerId == layer);
            world.Fields.Add(new(field.Id, area.Id, layer, field.Algorithm, jobId, field.Width * field.Height, field.Values.Keys.ToList()));
        }
        foreach (var layer in output.Layers)
        {
            if (area.Layers.GetValueOrDefault(layer) is Materialization.Authored or Materialization.Protected) continue;
            area.Layers[layer] = Materialization.Generated;
        }
        if (output.WaterTransfers is not null) world.WaterTransfers[area.Id] = output.WaterTransfers;
        foreach (var connection in output.Connections ?? []) world.Connections[connection.Id] = connection;
        Refinement.ValidateArea(world, area);
        Dependencies.ValidateBindings(world);
        var changed = output.Features.Select(f => f.Id).Concat(current.Features.Keys.Except(world.Features.Keys)).ToHashSet();
        changed.UnionWith(Dependencies.Affected(current, changed.Where(current.Features.ContainsKey)));
        changed.UnionWith(Dependencies.Affected(world, changed.Where(world.Features.ContainsKey)));
        Topology.ValidateCurrent(world, changed);
        Topology.ValidateContracts(world, changed);
        foreach (var connection in world.Connections.Values) Networks.Validate(world, connection);
        if (output.Features.Any(f => f.Kind is "river" or "road" or "cave")) Topology.Rebuild(world);
        area.Version++;
        world.Generations.Add(new(jobId, area.Id, input.Request.Seed, string.Join("+", Registry.All.Where(c => input.Request.Domains.Contains(c.Id)).Select(c => c.Algorithm)),
            input.Request.Quality, input.Request.Domains, area.Boundary?.Version ?? 0,
            area.Boundary?.Epochs ?? input.World.Epochs, DateTimeOffset.UtcNow, output.Warnings));
        world.Version++;
        return world;
    }

}
