using Atlas.Domain;
using System.Text.Json.Nodes;
using Xunit;

namespace Atlas.Tests;

public class SpatialContractTests
{
    [Fact]
    public void Local_and_vertical_frames_roundtrip_without_earth_coordinates()
    {
        var frame = new LocalFrame(new(5123456.78, 1987654.32, -21), 127.5, 0.3048, "crypt");
        var local = new Position(0.001, 17.852, 3.2);
        var back = frame.FromWorld(frame.ToWorld(local));
        Assert.Equal(local.X, back.X, 7);
        Assert.Equal(local.Y, back.Y, 7);
        Assert.Equal(local.Z, back.Z, 7);
        Assert.Throws<DomainException>(() => new LocalFrame(new(0, 0), MetresPerUnit: 0).Validate());
    }

    [Fact]
    public void Sparse_refinement_skips_profiles_and_inherits_real_boundary_fields()
    {
        var world = MakeWorld();
        var root = world.Areas.Values.Single();
        var field = new FieldData(Guid.NewGuid(), root.Id, [0, 0, 100, 100], 2, 2,
            new() { ["elevation"] = [100, 100, 0, 0] }, "test", 1);
        var river = River(root.Id);
        world.Features.Add(river.Id, river);
        var input = new CreateArea(root.Id, "Region", Profile.Region, Spatial.Rectangle(10, 20, 80, 60),
            new(new(10, 20)), "procedural", ["physical"]);
        var region = Commands.AddArea(world, input, [field], EmptyImpact());
        Assert.Equal(2, region.Boundary!.Crossings.Count);
        Assert.All(region.Boundary.Samples, s => Assert.InRange(s.Values["elevation"], 20 - 1e-8, 80 + 1e-8));
        var site = Commands.AddArea(world, new(region.Id, "Site", Profile.Site, Spatial.Rectangle(20, 30, 10, 10),
            new(new(20, 30)), "manual", ["pois"]), [], EmptyImpact());
        Assert.Equal(region.Id, site.ParentId);
        Assert.DoesNotContain(world.Areas.Values, a => a.Profile == Profile.Local);
    }

    [Fact]
    public void River_identity_survives_meanders_and_outlet_edits_fail_atomically()
    {
        var world = MakeWorld();
        var root = world.Areas.Values.Single();
        var river = River(root.Id);
        world.Features.Add(river.Id, river);
        var region = Commands.AddArea(world, new(root.Id, "Region", Profile.Region, Spatial.Rectangle(10, 20, 80, 60),
            new(new(10, 20)), "manual", ["physical"]), [], EmptyImpact());
        var edit = AtlasJson.Clone(river);
        edit.Geometry = Spatial.Line([new(50, 20), new(45, 40), new(55, 60), new(50, 80)]);
        var proposal = Commands.Preview(world, CommandFor("putFeature", new EditFeature(region.Id, edit), world.Version), "user");
        Assert.Single(proposal.Candidate.Features);
        Assert.True(proposal.Candidate.Features[river.Id].Detail.ContainsKey(region.Id));
        edit.Geometry = Spatial.Line([new(50, 20), new(45, 40), new(60, 80)]);
        var error = Assert.Throws<DomainException>(() => Commands.Preview(world,
            CommandFor("putFeature", new EditFeature(region.Id, edit), world.Version), "user"));
        Assert.Equal("locked_boundary", error.Code);
        Assert.Empty(world.Features[river.Id].Detail);
    }

    [Fact]
    public void Conflicting_ownership_and_unexplained_trait_relaxation_are_rejected()
    {
        var world = MakeWorld();
        var root = world.Areas.Values.Single();
        root.Traits.Add(new("relief", TraitKind.Hard, 0, 30));
        var first = Commands.AddArea(world, new(root.Id, "One", Profile.Region, Spatial.Rectangle(0, 0, 50, 50),
            new(new(0, 0)), "blank", ["physical"]), [], EmptyImpact());
        Assert.Throws<DomainException>(() => Commands.AddArea(world, new(root.Id, "Two", Profile.Region,
            Spatial.Rectangle(25, 25, 50, 50), new(new(25, 25)), "blank", ["physical"]), [], EmptyImpact()));
        Assert.Throws<DomainException>(() => Refinement.ValidateTraits(first.Traits, [new("relief", TraitKind.Hard, 0, 100)]));
        Assert.Throws<DomainException>(() => Refinement.ValidateTraits([], [new("temperature", TraitKind.Exception, 0, 50)]));
    }

    [Fact]
    public void Magic_cycles_and_protected_agent_edits_are_rejected()
    {
        var world = MakeWorld();
        var id = Guid.NewGuid();
        Assert.Throws<DomainException>(() => MagicAuthoring.Put(world,
            new(id, "Loop", new(10, 10), 20, 10, "radial", "heat", DependsOn: [id]), EmptyImpact()));
        var root = world.Areas.Values.Single();
        var river = River(root.Id);
        world.Features.Add(river.Id, river);
        Assert.Throws<DomainException>(() => Commands.Preview(world,
            CommandFor("putFeature", new EditFeature(root.Id, river), world.Version), "agent:test"));
    }

    internal static World MakeWorld() => Commands.NewWorld(new("Test", 42, 100, 100), "local");
    internal static Impact EmptyImpact() => new([], [], [], [], false);
    internal static Command CommandFor<T>(string kind, T value, long version) => new(Guid.NewGuid(), version, kind,
        System.Text.Json.JsonSerializer.SerializeToNode(value, AtlasJson.Options)!.AsObject());
    internal static Feature River(Guid root) => new()
    {
        Name = "River",
        Kind = "river",
        LayerId = "rivers",
        AreaId = root,
        Geometry = Spatial.Line([new(50, 0), new(50, 100)]),
        Attributes = new JsonObject { ["flow"] = 12 }
    };
}
