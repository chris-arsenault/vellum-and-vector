using Atlas.Domain;
using Atlas.Generation;
using Xunit;

namespace Atlas.Tests;

public class HumanGeographyTests
{
    [Fact]
    public async Task Combined_human_domains_share_communities_and_refine_existing_people_and_polities()
    {
        var world = Commands.NewWorld(new("People and states", 25, 10000, 10000), "local");
        var root = world.Areas.Values.Single();
        var values = new Dictionary<string, double[]>();
        foreach (var (key, value) in new[] { ("elevation", 100d), ("bedrock", 100d), ("temperature", 420d), ("moisture", 600d), ("ice", 0d), ("flow", 3d) })
            values[key] = Enumerable.Repeat(value, 81).ToArray();
        var physical = new FieldData(Guid.NewGuid(), root.Id, [0, 0, 10000, 10000], 9, 9, values, "example", 25);
        world.Fields.Add(new(physical.Id, root.Id, "elevation", physical.Algorithm, Guid.NewGuid(), 81, values.Keys.ToList()));
        root.Layers["elevation"] = root.Layers["climate"] = Materialization.Generated;
        var request = new GenerationRequest(Guid.NewGuid(), world.Version, root.Id, ["cultural", "political"], 25, "draft");
        var input = new GenerationInput(world, request, [physical]);
        var result = await Runner.Run(input, Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        world = Runner.Merge(world, input, result, Guid.NewGuid());
        var culture = result.Fields.Single(f => f.Values.ContainsKey("population"));
        Assert.Equal(world.HumanEras.Count, culture.HumanHistory!.Count);
        Assert.Contains(culture.HumanHistory.SelectMany(h => h.Events), e => e.Kind == "migration" && e.Amount > 0);
        Assert.Contains(result.Entities, e => e.Kind == "community");
        Assert.Contains(result.Entities, e => e.Kind == "jurisdiction");
        var fields = new[] { physical }.Concat(result.Fields).ToList();
        var area = Commands.AddArea(world, new(root.Id, "Border region", Profile.Region, Spatial.Rectangle(2000, 2000, 6000, 6000), new(new(2000, 2000)), "procedural", request.Domains), fields, SpatialContractTests.EmptyImpact());
        var regional = new GenerationInput(world, request with { AreaId = area.Id, ExpectedVersion = world.Version }, fields);
        var detail = await Runner.Run(regional, Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        var local = detail.Fields.Single(f => f.Values.ContainsKey("population"));
        Assert.NotNull(local.Boundary);
        Assert.All(area.Boundary!.Samples, sample => Assert.Equal(sample.Values["population"], local.Sample("population", sample.Point), 6));
        var people = world.Entities.Values.Where(e => e.Kind == "culture").Select(e => $"people:{e.Id}");
        foreach (var channel in people)
        {
            var target = ConservativeSampling.Average(new(culture.Bounds, culture.Width, culture.Height, culture.Values), channel, Spatial.Read(area.Footprint)) * Spatial.Read(area.Footprint).Area / 1_000_000;
            var total = local.Values[channel].Select((v, i) => v * local.Measures![i] / 1_000_000).Sum();
            Assert.Equal(target, total, 6);
        }
        Assert.All(detail.Entities.Where(e => e.Kind is "culture" or "polity"), e => Assert.Contains(e.Id, world.Entities.Keys));
        Runner.Merge(world, regional, detail, Guid.NewGuid());
        var regenerated = Demography.Generate(regional with { Fields = fields.Append(local).ToList() }, Guid.NewGuid(), Runner.ScopeField(physical, area, "draft")).Field;
        var mesh = new HumanMesh(regional, Runner.ScopeField(physical, area, "draft"));
        var edge = Spatial.Read(area.Footprint).Boundary;
        foreach (var i in mesh.Cells.Where(i => mesh.Support(i).Intersects(edge)))
            Assert.Equal(local.Values["population"][i], regenerated.Values["population"][i], 6);
    }

    [Fact]
    public void Adding_a_culture_to_existing_demography_seeds_its_population_and_resolves_an_unlocated_origin()
    {
        var world = Commands.NewWorld(new("New people", 1, 10000, 10000), "local"); var area = world.Areas.Values.Single();
        var physical = new FieldData(Guid.NewGuid(), area.Id, [0, 0, 10000, 10000], 3, 3,
            new() { ["elevation"] = Enumerable.Repeat(100d, 9).ToArray(), ["temperature"] = Enumerable.Repeat(420d, 9).ToArray(), ["moisture"] = Enumerable.Repeat(600d, 9).ToArray() }, "example", 1);
        var input = new GenerationInput(world, new(Guid.NewGuid(), world.Version, area.Id, ["cultural"], 1, "draft"), [physical]);
        var original = Demography.Generate(input, Guid.NewGuid(), physical);
        foreach (var entity in original.Entities) world.Entities[entity.Id] = entity;
        var newcomer = new Entity(Guid.NewGuid(), "Newcomers", "culture", new() { ["initialPopulation"] = 250 }, []);
        world.Entities.Add(newcomer.Id, newcomer);
        var regenerated = Demography.Generate(input with { Fields = [physical, original.Field] }, Guid.NewGuid(), physical);
        Assert.True(regenerated.Field.Values[$"people:{newcomer.Id}"].Sum() > 0);
        Assert.NotNull(regenerated.Entities.Single(e => e.Id == newcomer.Id).Attributes["center"]);
        Assert.Equal(original.Field.HumanHistory!.Count, regenerated.Field.HumanHistory!.Count);
    }
}
