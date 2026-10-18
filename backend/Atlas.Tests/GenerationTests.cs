using Atlas.Domain;
using Atlas.Generation;
using Xunit;

namespace Atlas.Tests;

public class GenerationTests
{
    [Fact]
    public async Task Canonry_epochs_produce_deterministic_fields_and_historical_provenance()
    {
        var world = Commands.NewWorld(new("Physical world", 41, 100000, 100000), "local");
        var root = world.Areas.Values.Single();
        var request = new GenerationRequest(Guid.NewGuid(), world.Version, root.Id, ["physical"], 41, "draft");
        var input = new GenerationInput(world, request, []);
        var first = await Runner.Run(input, Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        var second = await Runner.Run(input, Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        Assert.Equal(first.Fields[0].Values["elevation"], second.Fields[0].Values["elevation"]);
        Assert.True(first.Fields[0].Values["elevation"].Max() > first.Fields[0].Values["elevation"].Min());
        Assert.Contains("glacialHistory", first.Fields[0].Values.Keys);
        var merged = Runner.Merge(world, input, first, Guid.NewGuid());
        Assert.Equal(4, merged.Generations.Single().Epochs.Count);
        Assert.Equal(Materialization.Generated, merged.Areas[root.Id].Layers["elevation"]);
    }

    [Fact]
    public async Task Bounded_regeneration_keeps_crossings_protected_edits_and_fixed_history()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var field = FlatField(root.Id);
        world.Fields.Add(new(field.Id, root.Id, "elevation", "test", Guid.NewGuid(), 4));
        root.Layers["elevation"] = root.Layers["climate"] = Materialization.Generated;
        var river = SpatialContractTests.River(root.Id);
        river.Protected = false;
        river.State = Materialization.Generated;
        world.Features.Add(river.Id, river);
        var region = Commands.AddArea(world, new(root.Id, "Region", Profile.Region, Spatial.Rectangle(10, 20, 80, 60),
            new(new(10, 20)), "manual", ["physical"]), [field], SpatialContractTests.EmptyImpact());
        var poi = new Feature
        {
            Name = "Protected marker",
            Kind = "poi",
            LayerId = "pois",
            AreaId = region.Id,
            Geometry = Spatial.Write(Spatial.Point(new(30, 30))),
            Protected = true
        };
        world.Features.Add(poi.Id, poi);
        var request = new GenerationRequest(Guid.NewGuid(), world.Version, region.Id, ["physical"], 27, "draft");
        var input = new GenerationInput(AtlasJson.Clone(world), request, [field]);
        var result = await Runner.Run(input, Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        var current = AtlasJson.Clone(world);
        current.Features[poi.Id].Name = "Changed during generation";
        current.Version++;
        var merged = Runner.Merge(current, input, result, Guid.NewGuid());
        Assert.Equal("Changed during generation", merged.Features[poi.Id].Name);
        Assert.True(merged.Features[river.Id].Detail.ContainsKey(region.Id));
        Assert.Equal(world.Epochs, merged.Epochs);
        var detail = result.Fields.Single();
        Assert.Equal(field.Sample("elevation", new(10, 20)), detail.Sample("elevation", new(10, 20)), 6);
        Assert.All(region.Boundary!.Samples, sample => Assert.Equal(sample.Values["elevation"], detail.Sample("elevation", sample.Point), 5));
    }

    [Fact]
    public void Cultures_overlap_and_political_claims_are_separate_from_sovereignty()
    {
        var world = SpatialContractTests.MakeWorld();
        var area = world.Areas.Values.Single();
        var physical = FlatField(area.Id);
        var input = new GenerationInput(world, new(Guid.NewGuid(), world.Version, area.Id, ["cultural", "political"], 44, "draft"), [physical]);
        var culture = HumanGeography.Culture(input, Guid.NewGuid(), physical);
        Assert.True(culture.Entities.Count(e => e.Kind == "culture") >= 2);
        Assert.Contains(culture.Entities, e => e.Kind == "language");
        Assert.Contains(culture.Entities, e => e.Kind == "religion");
        Assert.All(culture.Entities.SelectMany(e => e.Relations), relation => Assert.Contains(culture.Entities, e => e.Id == relation.TargetId));
        Assert.All(culture.Field.Values.Where(v => v.Key.StartsWith("culture:", StringComparison.Ordinal)),
            item => Assert.Contains(item.Value, v => v > 0 && v < 1));
        var politics = HumanGeography.Politics(input, Guid.NewGuid(), physical);
        Assert.Contains(politics.Features, f => f.LayerId == "claims");
        Assert.Contains(politics.Features, f => f.LayerId == "control");
        Assert.DoesNotContain(politics.Entities, e => e.Kind == "culture");
    }

    private static FieldData FlatField(Guid area) => new(Guid.NewGuid(), area, [0, 0, 100, 100], 2, 2,
        new()
        {
            ["elevation"] = [100, 100, 0, 0],
            ["moisture"] = [500, 500, 500, 500],
            ["temperature"] = [400, 400, 400, 400],
            ["ice"] = [0, 0, 0, 0],
            ["rock"] = [300, 300, 300, 300],
            ["fracture"] = [500, 500, 500, 500],
            ["flow"] = [0, 0, 0, 0],
            ["glacialHistory"] = [0, 0, 0, 0],
            ["erosion"] = [0, 0, 0, 0]
        }, "test", 1);
}
