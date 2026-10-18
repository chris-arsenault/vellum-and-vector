using Atlas.Domain;
using Atlas.Generation;
using System.Text.Json.Nodes;
using Xunit;

namespace Atlas.Tests;

public class EnvironmentalTests
{
    [Fact]
    public async Task Selected_magic_runs_the_same_present_physical_response_as_combined_generation()
    {
        var world = Commands.NewWorld(new("Local forcing", 12, 1000, 1000), "local");
        var area = world.Areas.Values.Single();
        var values = new Dictionary<string, double[]>();
        foreach (var (key, value) in new[] { ("elevation", 100d), ("bedrock", 100d), ("temperature", 250d), ("rainfall", 300d),
            ("moisture", 400d), ("rock", 300d), ("fracture", 500d), ("ice", 5d), ("glacialHistory", 10d) })
            values[key] = Enumerable.Repeat(value, 81).ToArray();
        var source = new FieldData(Guid.NewGuid(), area.Id, [0, 0, 1000, 1000], 9, 9, values, "example", 12,
            History: [new(world.Epochs[0], new([0, 0, 1000, 1000], 9, 9, AtlasJson.Clone(values)), [])]);
        world.Fields.Add(new(source.Id, area.Id, "elevation", source.Algorithm, Guid.NewGuid(), 81, values.Keys.ToList()));
        area.Layers["elevation"] = area.Layers["climate"] = Materialization.Generated;
        world.Magic.Add(new(Guid.NewGuid(), "Present heat", new(500, 500), 700, 600, "radial", "heat", StartsAtEpoch: world.Epochs.Count));
        var request = new GenerationRequest(Guid.NewGuid(), world.Version, area.Id, ["magic"], 12, "draft");
        var selected = await Runner.Run(new(world, request, [source]), Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        var combined = await Runner.Run(new(world, request with { Domains = ["physical", "magic"] }, [source]), Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        var a = selected.Fields.Single(f => f.Values.ContainsKey("elevation"));
        var b = combined.Fields.Single(f => f.Values.ContainsKey("elevation"));
        Assert.Equal(a.Values["temperature"], b.Values["temperature"]);
        Assert.Equal(a.Values["ice"], b.Values["ice"]);
        Assert.True(a.Sample("temperature", new(500, 500)) > 250);
        Assert.True(a.Sample("ice", new(500, 500)) < 5);
        Assert.Equal(System.Text.Json.JsonSerializer.Serialize(source.History, AtlasJson.Options), System.Text.Json.JsonSerializer.Serialize(a.History, AtlasJson.Options));
    }

    [Fact]
    public async Task Present_forcing_preserves_epochs_and_past_ice_while_recomputing_environment()
    {
        var world = Commands.NewWorld(new("Forcing", 41, 100000, 100000), "local");
        var area = world.Areas.Values.Single();
        var coastal = new MagicRule(Guid.NewGuid(), "Sea pressure", new(50000, 50000), 100000, 200, "ocean", "coastal");
        MagicAuthoring.Put(world, coastal, SpatialContractTests.EmptyImpact());
        var request = new GenerationRequest(Guid.NewGuid(), world.Version, area.Id, ["physical", "magic"], 41, "draft");
        var firstInput = new GenerationInput(AtlasJson.Clone(world), request, []);
        var first = await Runner.Run(firstInput, Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        world = Runner.Merge(world, firstInput, first, Guid.NewGuid());
        var epochs = AtlasJson.Clone(world.Epochs);
        var heat = new MagicRule(Guid.NewGuid(), "Present heat", new(50000, 50000), 100000, 150, "radial", "heat");
        MagicAuthoring.Put(world, heat, SpatialContractTests.EmptyImpact());
        var secondInput = new GenerationInput(world, request with { ExpectedVersion = world.Version }, first.Fields);
        var second = await Runner.Run(secondInput, Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        var before = first.Fields.Single(f => f.Values.ContainsKey("elevation"));
        var after = second.Fields.Single(f => f.Values.ContainsKey("elevation"));
        Assert.Equal(epochs, world.Epochs);
        Assert.Equal(before.Values["glacialHistory"], after.Values["glacialHistory"]);
        Assert.Contains(after.Values["temperature"].Zip(before.Values["temperature"]), pair => pair.First != pair.Second);
        Assert.Equal(before.Values["naturalTemperature"], after.Values["naturalTemperature"]);
        Assert.Contains(after.Values["temperature"].Zip(after.Values["naturalTemperature"]), pair => pair.First != pair.Second);
        Assert.All(after.Values.Values.SelectMany(v => v), value => Assert.True(double.IsFinite(value)));
    }

    [Fact]
    public void Ocean_propagation_cannot_cross_a_land_barrier()
    {
        var field = new FieldData(Guid.NewGuid(), Guid.NewGuid(), [0, 0, 4, 1], 5, 2,
            new() { ["elevation"] = [-1, -1, 1, -1, -1, -1, -1, 1, -1, -1] }, "test", 1);
        var rule = new MagicRule(Guid.NewGuid(), "Ocean source", new(0, 0), 100, 10, "ocean", "coastal");
        var result = MagicPropagation.Solve(rule, new RasterMagicMesh(field), 0);
        Assert.True(result[1] > 0);
        Assert.Equal(0, result[4]);
    }

    [Fact]
    public void River_meanders_keep_locked_elevations_and_discharge()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var river = SpatialContractTests.River(root.Id);
        river.Attributes["elevations"] = new JsonArray(100, 0);
        river.Attributes["flow"] = 10;
        world.Features.Add(river.Id, river);
        var child = Commands.AddArea(world, new(root.Id, "Child", Profile.Region, Spatial.Rectangle(10, 20, 80, 60),
            new(new(10, 20)), "manual", ["physical"]), [], SpatialContractTests.EmptyImpact());
        var edit = AtlasJson.Clone(river);
        edit.Geometry = Spatial.Line([new(50, 20), new(60, 50), new(50, 80)]);
        var proposal = Commands.Preview(world, SpatialContractTests.CommandFor("putFeature", new EditFeature(child.Id, edit), world.Version), "user");
        var detail = proposal.Candidate.Features[river.Id];
        Assert.Equal(80, Hydrology.ElevationAt(Refinement.GeometryFor(proposal.Candidate, detail, child.Id),
            Refinement.AttributesFor(proposal.Candidate, detail, child.Id), new(50, 20)));
        edit.Attributes["flow"] = 20;
        var error = Assert.Throws<DomainException>(() => Commands.Preview(world,
            SpatialContractTests.CommandFor("putFeature", new EditFeature(child.Id, edit), world.Version), "user"));
        Assert.Equal("locked_flow", error.Code);
    }
}
