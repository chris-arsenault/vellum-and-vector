using Atlas.Domain;
using Atlas.Generation;
using Xunit;

namespace Atlas.Tests;

public class SpatialAuthorityTests
{
    [Fact]
    public void Authored_subgrid_patches_cannot_bypass_elevation_or_relief_limits()
    {
        foreach (var constraint in new[] { "elevation", "relief" })
        {
            var world = SpatialContractTests.MakeWorld();
            var root = world.Areas.Values.Single();
            root.Traits.Add(new(constraint, TraitKind.Hard, 0, 5));
            var field = new FieldData(Guid.NewGuid(), root.Id, [0, 0, 100, 100], 4, 4,
                new() { ["elevation"] = new double[16] }, "test", 1);
            world.Fields.Add(new(field.Id, root.Id, "elevation", "test", Guid.NewGuid(), 16, ["elevation"]));
            var command = SpatialContractTests.CommandFor("sculptField", new Sculpt(root.Id, "elevation", new(50, 50), 20, 10), world.Version);
            var error = Assert.Throws<DomainException>(() => Commands.Preview(world, command, "user", [field]));
            Assert.Equal("trait_conflict", error.Code);
        }
    }

    [Fact]
    public void A_child_meander_replaces_only_its_world_patch_and_other_reaches_remain_editable()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var river = SpatialContractTests.River(root.Id);
        river.State = Materialization.Generated;
        river.Protected = false;
        world.Features.Add(river.Id, river);
        var child = Commands.AddArea(world, new(root.Id, "River valley", Profile.Region,
            Spatial.Rectangle(10, 20, 80, 60), new(new(10, 20)), "manual", ["physical"]), [], SpatialContractTests.EmptyImpact());
        var edited = AtlasJson.Clone(river);
        edited.Geometry = Spatial.Line([new(50, 20), new(65, 50), new(50, 80)]);
        edited.Protected = true;
        var result = Commands.Preview(world, SpatialContractTests.CommandFor("putFeature", new EditFeature(child.Id, edited), world.Version), "user").Candidate;
        var onWorld = Composition.ForArea(result, result.Features[river.Id], root.Id)!;
        Assert.Contains(Spatial.Read(onWorld.Geometry).Coordinates, p => p.X == 65 && p.Y == 50);
        Assert.Contains(Spatial.Read(onWorld.Geometry).Coordinates, p => p.X == 50 && p.Y == 0);
        Assert.Equal(0, Spatial.Read(onWorld.Geometry).Distance(Spatial.Point(new(50, 100))));
        Assert.Equal(Materialization.Generated, result.Features[river.Id].State);
        Assert.False(result.Features[river.Id].Protected);
        Assert.True(result.Features[river.Id].Detail[child.Id].Protected);
        Assert.Equal(100, Spatial.Read(result.Features[river.Id].Geometry).Length);
    }

    [Fact]
    public void Effective_constraints_change_with_ancestors_without_copying_old_intent()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        root.Traits.Add(new("relief", TraitKind.Hard, 0, 100));
        var child = Commands.AddArea(world, new(root.Id, "Plain", Profile.Region, Spatial.Rectangle(10, 10, 50, 50),
            new(new(10, 10)), "manual", []), [], SpatialContractTests.EmptyImpact());
        var result = Commands.Preview(world, SpatialContractTests.CommandFor("setTraits", new
        {
            areaId = root.Id,
            traits = new[] { new Trait("relief", TraitKind.Hard, 0, 20) }
        }, world.Version), "user").Candidate;
        Assert.Equal(20, Constraints.Effective(result, child.Id).Single().Maximum);
        Assert.Empty(result.Areas[child.Id].LocalTraits!);
        Assert.Equal(20, result.Areas[child.Id].Traits.Single().Maximum);
    }

    [Fact]
    public void Overlapping_floors_are_distinct_spaces_and_their_entrances_remain_located()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var floors = new[] { 0, 1 }.Select(z => Commands.AddArea(world, new(root.Id, $"Floor {z}", Profile.Interior,
            Spatial.Rectangle(10, 10, 30, 30), new(new(10, 10, z * 3), Floor: z.ToString()), "manual", []), [], SpatialContractTests.EmptyImpact())).ToList();
        var room = new Feature { Name = "Upper room", Kind = "room", AreaId = floors[1].Id, LayerId = "structures", Geometry = Spatial.Rectangle(15, 15, 5, 5) };
        world.Features.Add(room.Id, room);
        Assert.Null(Composition.ForArea(world, room, floors[0].Id));
        Assert.NotNull(Composition.ForArea(world, room, floors[1].Id));
        Assert.Null(Composition.ForArea(world, room, root.Id));
        Assert.Contains(world.Features.Values.Where(f => f.Kind == "entrance"), f => Composition.Visible(world, f, root.Id));
    }

    [Fact]
    public void Directed_boundary_and_shared_network_junctions_survive_ordinary_edits()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var river = SpatialContractTests.River(root.Id);
        river.Protected = false;
        world.Features.Add(river.Id, river);
        var child = Commands.AddArea(world, new(root.Id, "Valley", Profile.Region, Spatial.Rectangle(10, 20, 80, 60),
            new(new(10, 20)), "manual", []), [], SpatialContractTests.EmptyImpact());
        Assert.Equal(new[] { "inlet", "outlet" }, child.Boundary!.Crossings.OrderBy(c => c.Point.Y).Select(c => c.Direction));
        var edit = AtlasJson.Clone(river);
        edit.Geometry = Spatial.Line([new(50, 80), new(50, 20)]);
        var error = Assert.Throws<DomainException>(() => Commands.Preview(world,
            SpatialContractTests.CommandFor("putFeature", new EditFeature(child.Id, edit), world.Version), "user"));
        Assert.Equal("locked_direction", error.Code);
        var tributary = new Feature { Name = "Tributary", Kind = "river", AreaId = root.Id, LayerId = "rivers", Geometry = Spatial.Line([new(5, 50), new(50, 50)]), Protected = false };
        world.Features.Add(tributary.Id, tributary);
        Topology.Rebuild(world);
        Assert.Contains(world.NetworkNodes.Values, n => world.NetworkReaches.Values.Count(r => r.Start == n.Id || r.End == n.Id) == 3);
    }

    [Fact]
    public void Connected_entrances_cannot_be_stranded_and_following_borders_use_the_river()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var interior = Commands.AddArea(world, new(root.Id, "Interior", Profile.Interior, Spatial.Rectangle(10, 10, 30, 30),
            new(new(10, 10)), "manual", []), [], SpatialContractTests.EmptyImpact());
        var entrance = world.Features.Values.Single();
        var edit = AtlasJson.Clone(entrance);
        edit.Geometry = Spatial.Write(Spatial.Point(new(20, 20)));
        var error = Assert.Throws<DomainException>(() => Commands.Preview(world,
            SpatialContractTests.CommandFor("putFeature", new EditFeature(interior.Id, edit), world.Version), "user"));
        Assert.Equal("attached_connection", error.Code);
        var river = SpatialContractTests.River(root.Id);
        var border = new Feature
        {
            Name = "River frontier",
            Kind = "border",
            LayerId = "claims",
            AreaId = root.Id,
            Geometry = river.Geometry,
            Relations = [new(river.Id, "follows")]
        };
        world.Features.Add(river.Id, river);
        world.Features.Add(border.Id, border);
        Assert.Contains(border.Id, Dependencies.Affected(world, [river.Id]));
        Assert.True(Composition.Geometry(world, river).EqualsTopologically(Composition.Geometry(world, border)));
    }

    [Fact]
    public void Fields_compose_fine_patches_and_keep_authored_samples_after_resampling()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var child = Commands.AddArea(world, new(root.Id, "Survey", Profile.Region, Spatial.Rectangle(10, 10, 80, 80),
            new(new(10, 10)), "manual", []), [], SpatialContractTests.EmptyImpact());
        var coarse = new FieldData(Guid.NewGuid(), root.Id, [0, 0, 100, 100], 2, 2, new() { ["survey"] = [1, 1, 1, 1] }, "test", 1);
        world.Layers.Add("survey", new("survey", "Survey", "custom", "field", "#778899", [Profile.World, Profile.Region], []));
        var fine = new FieldData(Guid.NewGuid(), child.Id, [10, 10, 90, 90], 4, 4, new() { ["survey"] = Enumerable.Repeat(3d, 16).ToArray() }, "test", 1);
        world.Fields.Add(new(coarse.Id, root.Id, "survey", "test", Guid.NewGuid(), 4, ["survey"]));
        world.Fields.Add(new(fine.Id, child.Id, "survey", "test", Guid.NewGuid(), 16, ["survey"]));
        Assert.Equal(3, FieldComposition.Sample(world, [coarse, fine], root.Id, "survey", new(50, 50)));
        Assert.Equal(1, FieldComposition.Sample(world, [coarse, fine], root.Id, "survey", new(5, 5)));
        Assert.False(Spatial.Read(FieldComposition.Coverage(world, coarse, "survey")).Covers(Spatial.Point(new(50, 50))));
        var sculpt = SpatialContractTests.CommandFor("sculptField", new Sculpt(child.Id, "survey", new(50, 50), 15, 4), world.Version);
        var result = Commands.Preview(world, sculpt, "user", [coarse, fine]);
        var artifact = result.Artifacts!.Single();
        var rebuilt = new FieldData(Guid.NewGuid(), child.Id, fine.Bounds, 8, 8,
            new() { ["survey"] = Enumerable.Repeat(99d, 64).ToArray() }, "test", 2, Authored: artifact.Authored);
        Assert.Equal(artifact.Sample("survey", new(50, 50)), rebuilt.Sample("survey", new(50, 50)));
        Assert.Equal(99, rebuilt.Sample("survey", new(20, 20)));
    }
}
