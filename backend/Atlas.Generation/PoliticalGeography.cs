using Atlas.Domain;
using System.Text.Json.Nodes;

namespace Atlas.Generation;

public static class PoliticalGeography
{
    public static (List<Entity> Entities, List<Feature> Features, FieldData Field) Generate(GenerationInput input, Guid jobId, FieldData physical)
    {
        var world = input.World; var area = world.Areas[input.Request.AreaId]; var mesh = new HumanMesh(input, physical);
        var polities = HumanGeography.ExistingOrCreate(world, "polity", 4, input.Request.Seed);
        var entities = polities.ToList(); var features = new List<Feature>(); var count = mesh.Measures.Length;
        var culture = input.Fields.Where(f => Registry.IsAncestor(world, f.AreaId, area.Id) && f.Values.ContainsKey("population"))
            .OrderBy(f => world.Areas[f.AreaId].Profile).LastOrDefault();
        var source = input.Fields.Where(f => Registry.IsAncestor(world, f.AreaId, area.Id) && f.Values.Keys.Any(k => k.StartsWith("reach:", StringComparison.Ordinal)))
            .OrderBy(f => world.Areas[f.AreaId].Profile).LastOrDefault();
        var owner = Enumerable.Repeat(-1, count).ToArray(); var controller = Enumerable.Repeat(-1, count).ToArray();
        var claimed = polities.Select(_ => new bool[count]).ToArray(); var reaches = polities.Select(_ => new double[count]).ToArray();
        var origins = new int[polities.Count]; var costs = new double[polities.Count][];
        for (var n = 0; n < polities.Count; n++)
        {
            var polity = polities[n]; var center = HumanGeography.Origin(world, polity, mesh);
            var origin = mesh.Nearest(center);
            if (!world.Entities.ContainsKey(polity.Id))
            {
                origin = mesh.Cells.Where(i => mesh.Capacity[i] > 0).OrderByDescending(i =>
                    (1 + (culture?.Sample("population", mesh.Point(i)) ?? mesh.Suitability(mesh.Point(i)))) /
                    (1 + Spatial.Point(center).Distance(Spatial.Point(mesh.Point(i))) / Math.Max(1, mesh.Scale))).DefaultIfEmpty(origin).First();
                polity.Attributes["center"] = System.Text.Json.JsonSerializer.SerializeToNode(mesh.Point(origin), AtlasJson.Options);
            }
            origins[n] = origin;
            costs[n] = mesh.Distances(origin, (a, b) => 1 + Math.Abs(mesh.Value("elevation", a) - mesh.Value("elevation", b)) / 250 + Math.Log(1 + mesh.Value("flow", b)) * .03);
            var foundingCulture = world.Entities.Values.Where(e => e.Kind == "culture").OrderByDescending(e => culture?.Sample($"culture:{e.Id}", mesh.Point(origin)) ?? 0).FirstOrDefault();
            if (foundingCulture is not null && !polity.Relations.Any(r => r.Kind == "foundingCulture")) polity.Relations.Add(new(foundingCulture.Id, "foundingCulture"));
            foreach (var i in mesh.Cells)
            {
                claimed[n][i] = source?.Sample($"claim:{polity.Id}", mesh.Point(i)) >= .5;
                if (source?.Sample($"sovereignty:{polity.Id}", mesh.Point(i)) >= .5) owner[i] = n;
            }
        }
        var history = AtlasJson.Clone(source?.HumanHistory ?? []);
        var eras = source is null ? world.HumanEras : [new HumanEra("present-response", 25, PoliticalCapacity: world.HumanEras[^1].PoliticalCapacity)];
        foreach (var era in eras)
        {
            var events = new List<HumanEvent>();
            if (era.PhysicalEpoch is { } epoch && physical.History?.FirstOrDefault(e => e.Epoch.Id == epoch) is { } episode)
            {
                var context = new HumanMesh(input, HumanMesh.Historical(physical, episode.Surface));
                for (var n = 0; n < polities.Count; n++) costs[n] = context.Distances(origins[n]);
            }
            for (var n = 0; n < polities.Count; n++)
            {
                var polity = polities[n]; var center = mesh.Point(origins[n]); var founding = polity.Relations.FirstOrDefault(r => r.Kind == "foundingCulture");
                var cohesion = polity.Attributes["cohesion"]?.GetValue<double>() ?? .8;
                var resources = Math.Log(1 + (culture?.Sample("population", center) ?? mesh.Suitability(center) * 10));
                var budget = mesh.Scale * (.3 + cohesion * .25 + resources * .03) * era.PoliticalCapacity;
                foreach (var i in mesh.Cells)
                {
                    var affinity = founding is null ? .5 : culture?.Sample($"culture:{founding.TargetId}", mesh.Point(i)) ?? .5;
                    var strength = Math.Exp(-costs[n][i] / Math.Max(1, budget)) * (1 + affinity * .35) * cohesion;
                    if (source is not null && source.AreaId != area.Id)
                        strength = source.Sample($"reach:{polity.Id}", mesh.Point(i)) * (.8 + .2 * strength);
                    reaches[n][i] = mesh.Capacity[i] > 0 ? strength : 0;
                    if (strength >= .3 && mesh.Capacity[i] > 0) claimed[n][i] = true;
                }
            }
            foreach (var i in mesh.Cells.Where(i => mesh.Capacity[i] > 0))
            {
                var strongest = Enumerable.Range(0, polities.Count).MaxBy(n => reaches[n][i]);
                var prior = owner[i];
                if (reaches[strongest][i] > .3 && (prior < 0 || reaches[strongest][i] > reaches[prior][i] * 1.2)) owner[i] = strongest;
                controller[i] = reaches[strongest][i] > .42 ? strongest : -1;
                if (source is not null && source.AreaId != area.Id && Spatial.Read(area.Footprint).Boundary.Distance(Spatial.Point(mesh.Point(i))) < mesh.Scale / Math.Max(physical.Width, physical.Height))
                    owner[i] = prior;
                if (owner[i] != prior && owner[i] >= 0) events.Add(new(prior < 0 ? "expansion" : "conquest", polities[owner[i]].Id, mesh.Point(i), mesh.Measures[i], prior < 0 ? [] : [polities[prior].Id]));
            }
            if (source is null) history.Add(new(era, new(physical.Bounds, physical.Width, physical.Height, Values()),
                events.GroupBy(e => (e.Kind, e.Actor)).Select(g => new HumanEvent(g.Key.Kind, g.Key.Actor, g.First().Position, g.Sum(e => e.Amount), g.SelectMany(e => e.Causes).Distinct().ToList())).ToList()));
        }
        for (var n = 0; n < polities.Count; n++)
        {
            var polity = polities[n];
            Add("sovereignty", mesh.Cells.Where(i => owner[i] == n), "recognized-title");
            Add("control", mesh.Cells.Where(i => controller[i] == n), "current-supply-and-local-support");
            Add("claims", mesh.Cells.Where(i => claimed[n][i]), "retained-historical-reach");
            var center = AtlasJson.Read<Position>(polity.Attributes["center"]!);
            if (Spatial.Read(area.Footprint).Covers(Spatial.Point(center)))
                features.Add(HumanGeography.Generated(world, area, jobId, $"{polity.Name} capital", "capital", "settlements", Spatial.Write(Spatial.Point(center)), $"capital:{polity.Id}", relations: [new(polity.Id, "capitalOf")]));
            var territory = mesh.Cells.Where(i => owner[i] == n).ToHashSet();
            var hubs = world.Entities.Values.Where(e => e.Kind == "community" && e.Attributes["center"] is not null)
                .Select(e => (Cell: mesh.Nearest(AtlasJson.Read<Position>(e.Attributes["center"]!)), Id: e.Id)).Where(h => territory.Contains(h.Cell)).DistinctBy(h => h.Cell).ToList();
            if (hubs.Count == 0 && territory.Count > 0) hubs.Add((territory.MaxBy(i => mesh.Capacity[i]), polity.Id));
            var hubCosts = hubs.Select(hub => mesh.Distances(hub.Cell, (_, b) => territory.Contains(b) ? 1 : 10000)).ToList();
            foreach (var h in Enumerable.Range(0, hubs.Count))
            {
                var cells = territory.Where(i => Enumerable.Range(0, hubs.Count).MinBy(k => hubCosts[k][i]) == h).ToList();
                if (cells.Count == 0) continue;
                var id = Registry.Identity(world.Id, $"administration:{area.Id}:{polity.Id}:{hubs[h].Id}");
                entities.Add(new(id, $"{polity.Name} district {h + 1}", "jurisdiction", new() { ["center"] = System.Text.Json.JsonSerializer.SerializeToNode(mesh.Point(hubs[h].Cell), AtlasJson.Options) }, [new(polity.Id, "administeredBy")], Materialization.Generated));
                features.Add(HumanGeography.Generated(world, area, jobId, $"{polity.Name} district {h + 1}", "jurisdiction", "administration", Spatial.Write(mesh.Polygon(cells)),
                    $"administration:{area.Id}:{polity.Id}:{hubs[h].Id}", relations: [new(id, "jurisdiction"), new(polity.Id, "polity")]));
            }
            foreach (var other in Enumerable.Range(n + 1, polities.Count - n - 1))
            {
                var disputed = mesh.Cells.Where(i => claimed[n][i] && controller[i] == other || claimed[other][i] && controller[i] == n).ToList();
                var adjacent = mesh.Cells.Any(i => owner[i] == n && mesh.Links[i].Any(l => owner[l.To] == other));
                if (!adjacent && disputed.Count == 0) continue;
                var kind = disputed.Count > 0 ? "rival" : "tradePartner";
                if (!polity.Relations.Contains(new Relation(polities[other].Id, kind))) polity.Relations.Add(new(polities[other].Id, kind));
                if (!polities[other].Relations.Contains(new Relation(polity.Id, kind))) polities[other].Relations.Add(new(polity.Id, kind));
                if (disputed.Count > 0) features.Add(HumanGeography.Generated(world, area, jobId, $"{polity.Name} / {polities[other].Name} dispute", "dispute", "claims", Spatial.Write(mesh.Polygon(disputed)),
                    $"dispute:{area.Id}:{polity.Id}:{polities[other].Id}", new() { ["cause"] = "historical-claim-over-foreign-control" }, [new(polity.Id, "claimant"), new(polities[other].Id, "claimant")]));
            }
            void Add(string layer, IEnumerable<int> selected, string cause)
            {
                var cells = selected.ToList(); if (cells.Count == 0) return;
                features.Add(HumanGeography.Generated(world, area, jobId, $"{polity.Name} {layer}", layer, layer, Spatial.Write(mesh.Polygon(cells)),
                    $"{polity.Id}:{layer}", new() { ["entityId"] = polity.Id.ToString(), ["cause"] = cause }, [new(polity.Id, "polity")]));
            }
        }
        return (entities, features, new(Registry.Identity(jobId, "political-field"), area.Id, physical.Bounds, physical.Width, physical.Height,
            Values(), "historical-frontiers-v2", input.Request.Seed, Boundary: area.Boundary is { } boundary ? new(area.Footprint, boundary.Samples, boundary.Rings) : null, Measures: mesh.Measures, HumanHistory: history));

        Dictionary<string, double[]> Values()
        {
            var values = new Dictionary<string, double[]>();
            for (var n = 0; n < polities.Count; n++)
            {
                var id = polities[n].Id;
                values[$"reach:{id}"] = reaches[n].ToArray();
                values[$"sovereignty:{id}"] = owner.Select(o => o == n ? 1d : 0d).ToArray();
                values[$"control:{id}"] = controller.Select(o => o == n ? 1d : 0d).ToArray();
                values[$"claim:{id}"] = claimed[n].Select(v => v ? 1d : 0d).ToArray();
            }
            return values;
        }
    }
}
