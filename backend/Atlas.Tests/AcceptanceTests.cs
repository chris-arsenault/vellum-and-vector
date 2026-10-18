using Atlas.Domain;
using Atlas.Generation;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;

namespace Atlas.Tests;

public class AcceptanceTests
{
    [Fact]
    public void Parent_edits_cannot_bypass_child_network_locks()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var river = SpatialContractTests.River(root.Id);
        world.Features.Add(river.Id, river);
        Commands.AddArea(world, new(root.Id, "Locked", Profile.Region, Spatial.Rectangle(10, 20, 80, 60),
            new(new(10, 20)), "manual", ["physical"]), [], SpatialContractTests.EmptyImpact());
        var edit = AtlasJson.Clone(river);
        edit.Geometry = Spatial.Line([new(60, 0), new(60, 100)]);
        var error = Assert.Throws<DomainException>(() => Commands.Preview(world,
            SpatialContractTests.CommandFor("putFeature", new EditFeature(root.Id, edit), world.Version), "user"));
        Assert.Equal("locked_boundary", error.Code);
        Assert.Equal(50, Spatial.Read(world.Features[river.Id].Geometry).Coordinates[0].X);
        Assert.Throws<DomainException>(() => Commands.NewWorld(new("Globe", 1, 100, 100, Topology: "spherical"), "local"));
    }

    [Fact]
    public void Templates_bind_vertical_connections_and_keep_definitions_detached()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var site = Commands.AddArea(world, new(root.Id, "Site", Profile.Site, Spatial.Rectangle(10, 10, 60, 60),
            new(new(10, 10)), "manual", ["built"]), [], SpatialContractTests.EmptyImpact());
        var room = new Feature
        {
            Name = "Room",
            Kind = "room",
            LayerId = "structures",
            AreaId = Guid.Empty,
            Geometry = Spatial.Rectangle(1, 1, 8, 8)
        };
        var template = new Template(Guid.NewGuid(), "Crypt", Profile.Interior, [Profile.Site],
            Spatial.Rectangle(0, 0, 10, 10), [room], [], new(new(0, 0)));
        Templates.Save(world, template);
        Templates.Instantiate(world, new(template.Id, site.Id, "Located crypt", new(new(30, 30, -4), 90, 1, "crypt")),
            "user", [], SpatialContractTests.EmptyImpact());
        var interior = world.Areas.Values.Single(a => a.Profile == Profile.Interior);
        Assert.Equal(site.Id, interior.ParentId);
        var connection = Assert.Single(world.Connections.Values);
        Assert.Equal("vertical", connection.Kind);
        Assert.Equal(-4, connection.B.Position.Z);
        Assert.Equal(Guid.Empty, world.Templates[template.Id].Features.Single().AreaId);
        Assert.DoesNotContain(room.Id, world.Features.Keys);
        Assert.Throws<DomainException>(() => Networks.Connect(world, new(Guid.NewGuid(), "road",
            new(root.Id, new(0, 0)), new(site.Id, new(20, 20))), SpatialContractTests.EmptyImpact()));
        Networks.Connect(world, new(Guid.NewGuid(), "portal", new(root.Id, new(0, 0)),
            new(interior.Id, new(25, 35, -4))), SpatialContractTests.EmptyImpact());
        Assert.Equal(2, world.Connections.Count);
    }

    [Fact]
    public void A_custom_field_needs_no_generator_and_sculpting_preserves_its_snapshot()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        world.Layers.Add("survey", new("survey", "Survey confidence", "custom", "field", "#88aa77", [Profile.World], []));
        var create = SpatialContractTests.CommandFor("createField", new { areaId = root.Id, layerId = "survey", resolution = 8, value = 0.2 }, world.Version);
        var first = Commands.Preview(world, create, "user");
        var before = Assert.Single(first.Artifacts!);
        Assert.Equal(0.2, before.Sample("survey", new(50, 50)));
        var sculpt = SpatialContractTests.CommandFor("sculptField", new Sculpt(root.Id, "survey", new(50, 50), 40, 0.5), first.Candidate.Version);
        var second = Commands.Preview(first.Candidate, sculpt, "user", [before]);
        Assert.True(second.Artifacts![0].Sample("survey", new(50, 50)) > 0.2);
        Assert.Equal(0.2, before.Sample("survey", new(50, 50)));
        Assert.Empty(world.Fields);
    }

    [Fact]
    public void Cave_generation_inherits_substrate_water_and_ice_history_without_rewriting_epochs()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var cave = Commands.AddArea(world, new(root.Id, "Cave", Profile.Interior, Spatial.Rectangle(10, 10, 60, 60),
            new(new(10, 10, -8)), "manual", ["built"], Context: "cave"), [], SpatialContractTests.EmptyImpact());
        var field = ParentField(root.Id);
        var input = new GenerationInput(world, new(Guid.NewGuid(), world.Version, cave.Id, ["built"], 42, "draft"), [field]);
        var epochs = JsonSerializer.Serialize(world.Epochs, AtlasJson.Options);
        var generated = CaveGeneration.Generate(input, Guid.NewGuid(), field);
        Assert.NotEmpty(generated);
        Assert.All(generated, f => Assert.True(Spatial.Read(cave.Footprint).Covers(Spatial.Read(f.Geometry))));
        Assert.All(generated, f => Assert.True(f.Attributes["iceDamageHistory"]!.Deserialize<double>() > 0));
        Assert.Equal(epochs, JsonSerializer.Serialize(world.Epochs, AtlasJson.Options));
        Assert.Single(world.Connections);
        Assert.Contains(generated, f => f.Kind == "cave" && f.Relations.Count > 0);
    }

    [Fact]
    public async Task Magic_retains_natural_fields_and_present_sources_do_not_rewrite_past_forcing()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var physical = ParentField(root.Id);
        var rule = new MagicRule(Guid.NewGuid(), "Heat", new(50, 50), 100, 100, "fracture", "heat");
        MagicAuthoring.Put(world, rule, SpatialContractTests.EmptyImpact());
        var response = await BoundedRefinement.Generate(new(world, new(Guid.NewGuid(), world.Version, root.Id, ["physical", "magic"], 1, "draft"), [physical]), Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None, presentOnly: true);
        var magical = Magic.Field(world, root, response.Field, Guid.NewGuid());
        Assert.All(magical.Values["naturalTemperature"], value => Assert.Equal(400, value, 6));
        Assert.Contains(magical.Values["temperature"].Zip(magical.Values["naturalTemperature"]), pair => pair.First > pair.Second);
        Assert.All(physical.Values["temperature"], value => Assert.Equal(400, value));
        world.Generations.Add(new(Guid.NewGuid(), root.Id, 1, "test", "draft", ["physical"], 0, world.Epochs, DateTimeOffset.UtcNow, []));
        var present = rule with { Id = Guid.NewGuid() };
        MagicAuthoring.Put(world, present, SpatialContractTests.EmptyImpact());
        present = world.Magic.Single(r => r.Id == present.Id);
        Assert.Equal(0, Magic.Intensity(present, new(50, 50), 1000, 0, 1, 0));
        Assert.Throws<DomainException>(() => MagicAuthoring.Put(world, rule with { Strength = 200 }, SpatialContractTests.EmptyImpact()));
    }

    [Fact]
    public void Skipped_unmaterialized_levels_inherit_fields_and_parent_brushes_respect_their_edges()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var field = ParentField(root.Id);
        world.Fields.Add(new(field.Id, root.Id, "elevation", "test", Guid.NewGuid(), 4));
        var region = Commands.AddArea(world, new(root.Id, "Region", Profile.Region, Spatial.Rectangle(10, 10, 80, 80),
            new(new(10, 10)), "manual", []), [field], SpatialContractTests.EmptyImpact());
        var site = Commands.AddArea(world, new(region.Id, "Site", Profile.Site, Spatial.Rectangle(20, 20, 20, 20),
            new(new(20, 20)), "manual", []), [field], SpatialContractTests.EmptyImpact());
        Assert.All(site.Boundary!.Samples, sample => Assert.Equal(field.Sample("elevation", sample.Point), sample.Values["elevation"]));
        var error = Assert.Throws<DomainException>(() => Commands.Preview(world,
            SpatialContractTests.CommandFor("sculptField", new Sculpt(root.Id, "elevation", new(0, 0), 200, 10), world.Version), "user", [field]));
        Assert.Equal("locked_field_boundary", error.Code);
        var reconcile = Commands.Preview(world, SpatialContractTests.CommandFor("reconcileBoundary",
            new { sculpt = new Sculpt(root.Id, "elevation", new(0, 0), 200, 10) }, world.Version), "user", [field]);
        Assert.True(reconcile.Impact.HighImpact);
        Assert.Equal(2, reconcile.Candidate.Areas[region.Id].Boundary!.Version);
        Assert.Equal(field.Id, world.Fields.Single().Id);
        Assert.NotEqual(field.Id, reconcile.Candidate.Fields.Single().Id);
        Assert.Single(reconcile.Artifacts!);
    }

    private static FieldData ParentField(Guid area) => new(Guid.NewGuid(), area, [0, 0, 100, 100], 2, 2,
        new()
        {
            ["elevation"] = [100, 100, 50, 50],
            ["temperature"] = [400, 400, 400, 400],
            ["rock"] = [500, 500, 500, 500],
            ["moisture"] = [700, 700, 700, 700],
            ["fracture"] = [500, 500, 500, 500],
            ["glacialHistory"] = [800, 800, 800, 800],
            ["ice"] = [10, 10, 10, 10],
            ["flow"] = [0, 0, 0, 0]
        }, "test", 1);
}
