using Atlas.Domain;
using System.Text.Json.Nodes;

namespace Atlas.Generation;

public static class Demography
{
    public static (List<Entity> Entities, FieldData Field, List<Feature> Sites) Generate(GenerationInput input, Guid jobId, FieldData physical)
    {
        var world = input.World; var area = world.Areas[input.Request.AreaId]; var mesh = new HumanMesh(input, physical);
        var cultures = HumanGeography.ExistingOrCreate(world, "culture", 3, input.Request.Seed);
        var languages = HumanGeography.ExistingOrCreate(world, "language", 2, input.Request.Seed + 17);
        var faiths = HumanGeography.ExistingOrCreate(world, "religion", 2, input.Request.Seed + 41);
        var entities = cultures.Concat(languages).Concat(faiths).ToList();
        var series = entities.ToDictionary(Key, _ => new double[mesh.Measures.Length]);
        var source = input.Fields.Where(f => Registry.IsAncestor(world, f.AreaId, area.Id) && f.Values.ContainsKey("population"))
            .OrderBy(f => world.Areas[f.AreaId].Profile).LastOrDefault();
        var inherited = source is not null && area.Boundary is not null;
        var history = AtlasJson.Clone(source?.HumanHistory ?? []);
        var events = new List<HumanEvent>(); var sites = new List<Feature>(); var origins = new Dictionary<Guid, int>();
        foreach (var entity in entities)
        {
            var center = HumanGeography.Origin(world, entity, mesh);
            entity.Attributes["center"] = System.Text.Json.JsonSerializer.SerializeToNode(center, AtlasJson.Options);
            var origin = mesh.Nearest(center);
            if (!world.Entities.ContainsKey(entity.Id))
            {
                origin = mesh.Cells.Where(i => mesh.Capacity[i] > 0).OrderByDescending(i => mesh.Capacity[i] /
                    (1 + Spatial.Point(mesh.Point(i)).Distance(Spatial.Point(center)) / Math.Max(1, mesh.Scale))).DefaultIfEmpty(origin).First();
                entity.Attributes["center"] = System.Text.Json.JsonSerializer.SerializeToNode(mesh.Point(origin), AtlasJson.Options);
                entity.Attributes["originEra"] = world.HumanEras[0].Id;
            }
            origins[entity.Id] = origin;
            if (entity.Kind != "culture") continue;
            var language = languages[Math.Abs(entity.Id.GetHashCode() % languages.Count)];
            var faith = faiths[Math.Abs((entity.Id.GetHashCode() / 7) % faiths.Count)];
            entity.Relations.AddRange(new[] { new Relation(language.Id, "speaks"), new Relation(faith.Id, "practices") }.Except(entity.Relations));
            if (!inherited && Spatial.Read(area.Footprint).Covers(Spatial.Point(center)) && mesh.Capacity[origin] > 0) sites.Add(HumanGeography.Generated(world, area, jobId, $"{entity.Name} origin", "culturalOrigin", "cultures", Spatial.Write(Spatial.Point(mesh.Point(origin))),
                $"culture-origin:{entity.Id}", new() { ["era"] = entity.Attributes["originEra"]?.DeepClone() }, [new(entity.Id, "originOf")]));
        }
        if (source is not null)
        {
            var patch = new SampledPatch(source.Bounds, source.Width, source.Height, source.Values);
            var sameGrid = source.AreaId == area.Id && source.Width == physical.Width && source.Height == physical.Height && source.Bounds.SequenceEqual(physical.Bounds);
            foreach (var (key, counts) in series)
                foreach (var i in mesh.Cells)
                {
                    var density = source.Values.ContainsKey(key) ? sameGrid ? source.Values[key][i] : ConservativeSampling.Average(patch, key, mesh.Support(i)) :
                        source.Sample("population", mesh.Point(i)) * source.Sample(Prevalence(key), mesh.Point(i));
                    counts[i] = density * mesh.Measures[i] / 1_000_000;
                }
        }
        foreach (var culture in cultures.Where(c => source is null || !source.Values.ContainsKey(Key(c)) && !source.Values.ContainsKey(Prevalence(Key(c)))))
        {
            var center = AtlasJson.Read<Position>(culture.Attributes["center"]!);
            if (!Spatial.Read(area.Footprint).Covers(Spatial.Point(center))) continue;
            var origin = origins[culture.Id]; var population = culture.Attributes["initialPopulation"]?.GetValue<double>() ?? mesh.Capacity[origin] * .3;
            Guard.Require(double.IsFinite(population) && population >= 0, "initial_population", "Initial population must be finite and nonnegative.");
            series[Key(culture)][origin] += population;
            foreach (var group in new[] { languages, faiths })
            {
                var weights = group.Select(e => culture.Relations.Any(r => r.TargetId == e.Id) ? .85 : .15 / Math.Max(1, group.Count - 1)).ToArray();
                for (var i = 0; i < group.Count; i++) series[Key(group[i])][origin] += population * weights[i] / weights.Sum();
            }
            events.Add(new("origin", culture.Id, mesh.Point(origin), population, []));
        }
        var totals = series.ToDictionary(s => s.Key, s => s.Value.Sum());
        var edge = inherited ? Spatial.Read(area.Footprint).Boundary : null;
        var fixedCells = mesh.Cells.Where(i => edge is not null && mesh.Support(i).Intersects(edge)).ToHashSet();
        var fixedCounts = series.ToDictionary(s => s.Key, s => s.Value.ToArray());
        var eras = source is null ? world.HumanEras : [new HumanEra("present-response", 25)];
        foreach (var era in eras)
        {
            var episode = era.PhysicalEpoch is { } epoch ? physical.History?.FirstOrDefault(e => e.Epoch.Id == epoch) : null;
            var context = episode is null ? mesh : new HumanMesh(input, HumanMesh.Historical(physical, episode.Surface));
            double Suitability(int i) => context.Suitability(mesh.Point(i));
            var before = Population().Sum();
            var migration = cultures.ToDictionary(c => c.Id, _ => 0d);
            var steps = Math.Max(4, (int)Math.Ceiling(era.Years / 20d));
            for (var step = 0; step < steps; step++)
            {
                var population = Population();
                foreach (var i in mesh.Cells)
                {
                    if (fixedCells.Contains(i)) continue;
                    var capacity = Suitability(i) * 120 * mesh.Measures[i] / 1_000_000;
                    var growth = capacity == 0 ? .8 : Math.Clamp(1 + .018 * era.Years / steps * (1 - population[i] / Math.Max(.01, capacity)), .5, 1.4);
                    foreach (var counts in series.Values) counts[i] *= growth;
                }
                population = Population();
                var destination = new Dictionary<int, List<(int Cell, double Weight)>>();
                foreach (var i in mesh.Cells)
                {
                    var choices = context.Links[i].Where(link => !fixedCells.Contains(i) && !fixedCells.Contains(link.To)).Select(link => (Cell: link.To,
                        Weight: Math.Max(.01, Suitability(link.To)) / (1 + population[link.To] / Math.Max(.01, mesh.Capacity[link.To])) / link.Cost)).ToList();
                    var total = choices.Sum(c => c.Weight);
                    destination[i] = choices.Select(c => (c.Cell, total > 0 ? c.Weight / total : 0)).ToList();
                }
                foreach (var (key, counts) in series)
                {
                    var delta = new double[counts.Length];
                    var mobility = Math.Clamp(.12 * era.Mobility * (key.StartsWith("faith:", StringComparison.Ordinal) ? 1.5 : 1), 0, .4);
                    foreach (var i in mesh.Cells)
                        foreach (var (target, weight) in destination[i])
                        {
                            var moved = counts[i] * mobility * weight;
                            delta[i] -= moved; delta[target] += moved;
                            if (key.StartsWith("people:", StringComparison.Ordinal)) migration[Guid.Parse(key[7..])] += moved;
                        }
                    foreach (var i in mesh.Cells) counts[i] = Math.Max(0, counts[i] + delta[i]);
                }
            }
            events.Add(new("population-change", cultures[0].Id, mesh.Point(origins[cultures[0].Id]), Population().Sum() - before, cultures.Select(e => e.Id).ToList()));
            foreach (var (id, moved) in migration) events.Add(new("migration", id, mesh.Point(origins[id]), moved, []));
            if (source is null) history.Add(new(era, new(physical.Bounds, physical.Width, physical.Height, Values()), events.ToList()));
            events.Clear();
        }
        if (inherited) foreach (var (key, counts) in series)
            {
                var fixedTotal = fixedCells.Sum(i => fixedCounts[key][i]);
                var interior = mesh.Cells.Where(i => !fixedCells.Contains(i)).ToList();
                var total = interior.Sum(i => counts[i]);
                if (total > 0) foreach (var i in interior) counts[i] *= Math.Max(0, totals[key] - fixedTotal) / total;
                foreach (var i in fixedCells) counts[i] = fixedCounts[key][i];
            }
        var values = Values();
        foreach (var culture in cultures)
        {
            var counts = series[Key(culture)]; var chosen = new List<int>();
            foreach (var i in mesh.Cells.Where(i => counts[i] > 0 && mesh.Capacity[i] > 0).OrderByDescending(i => counts[i]))
            {
                if (chosen.Any(j => Spatial.Point(mesh.Point(i)).Distance(Spatial.Point(mesh.Point(j))) < mesh.Scale / 8)) continue;
                chosen.Add(i); if (chosen.Count >= (area.Profile >= Profile.Local ? 6 : 3)) break;
            }
            foreach (var i in chosen)
            {
                var identity = $"community:{area.Id}:{culture.Id}:{chosen.IndexOf(i)}"; var id = Registry.Identity(world.Id, identity);
                var language = languages.MaxBy(e => series[Key(e)][i])!; var faith = faiths.MaxBy(e => series[Key(e)][i])!;
                var relations = new List<Relation> { new(culture.Id, "culture"), new(language.Id, "speaks"), new(faith.Id, "practices") };
                entities.Add(new(id, $"{culture.Name} community {chosen.IndexOf(i) + 1}", "community", new() { ["population"] = counts[i], ["center"] = System.Text.Json.JsonSerializer.SerializeToNode(mesh.Point(i), AtlasJson.Options) }, relations, Materialization.Generated));
                sites.Add(HumanGeography.Generated(world, area, jobId, $"{culture.Name} community", "community", "settlements", Spatial.Write(Spatial.Point(mesh.Point(i))), identity, new() { ["population"] = counts[i] }, [new(id, "community")]));
            }
        }
        foreach (var faith in faiths)
        {
            if (series[Key(faith)].Sum() <= 0) continue;
            var cell = mesh.Cells.MaxBy(i => series[Key(faith)][i]); var id = Registry.Identity(world.Id, $"institution:{area.Id}:{faith.Id}");
            entities.Add(new(id, $"{faith.Name} assembly", "institution", new() { ["center"] = System.Text.Json.JsonSerializer.SerializeToNode(mesh.Point(cell), AtlasJson.Options) }, [new(faith.Id, "practices")], Materialization.Generated));
            sites.Add(HumanGeography.Generated(world, area, jobId, $"{faith.Name} assembly", "institution", "religions", Spatial.Write(Spatial.Point(mesh.Point(cell))), $"institution:{area.Id}:{faith.Id}", relations: [new(id, "institution")]));
        }
        return (entities, new(Registry.Identity(jobId, "cultural-field"), area.Id, physical.Bounds, physical.Width, physical.Height, values,
            "demographic-routes-v2", input.Request.Seed, Boundary: area.Boundary is { } boundary ? new(area.Footprint, boundary.Samples, boundary.Rings) : null,
            Measures: mesh.Measures, HumanHistory: history), sites);

        double[] Population() => Enumerable.Range(0, mesh.Measures.Length).Select(i => cultures.Sum(c => series[Key(c)][i])).ToArray();
        Dictionary<string, double[]> Values()
        {
            var result = new Dictionary<string, double[]>(); var population = Population();
            result["population"] = new double[population.Length];
            foreach (var i in mesh.Cells) result["population"][i] = population[i] * 1_000_000 / mesh.Measures[i];
            foreach (var (key, counts) in series)
            {
                result[key] = new double[counts.Length]; result[Prevalence(key)] = new double[counts.Length];
                foreach (var i in mesh.Cells)
                {
                    result[key][i] = counts[i] * 1_000_000 / mesh.Measures[i];
                    result[Prevalence(key)][i] = Math.Clamp(counts[i] / Math.Max(1e-15, population[i]), 0, 1);
                }
            }
            return result;
        }
    }
    private static string Key(Entity entity) => $"{entity.Kind switch { "culture" => "people", "language" => "speakers", _ => "faith" }}:{entity.Id}";
    private static string Prevalence(string key) => key.Replace("people:", "culture:", StringComparison.Ordinal).Replace("speakers:", "language:", StringComparison.Ordinal).Replace("faith:", "religion:", StringComparison.Ordinal);
}
