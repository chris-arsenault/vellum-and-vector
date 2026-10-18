using Atlas.Domain;
using Atlas.Generation;
using Xunit;

namespace Atlas.Tests;

public class SpatialReconciliationTests
{
    [Fact]
    public void Generation_cannot_move_or_remove_a_connected_road()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var road = Line(root.Id, "Road", "road", 10);
        road.State = Materialization.Generated;
        Commands.AddArea(world, new(root.Id, "Door", Profile.Interior, Spatial.Rectangle(20, 5, 20, 20),
            new(new(25, 10)), "manual", []), [], SpatialContractTests.EmptyImpact());
        world.Features.Add(road.Id, road);
        var connection = world.Connections.Values.Single();
        world.Connections[connection.Id] = connection with { A = connection.A with { FeatureId = road.Id } };
        Topology.Rebuild(world);
        var input = new GenerationInput(AtlasJson.Clone(world), new(Guid.NewGuid(), world.Version, root.Id, ["built"], 1), []);
        var moved = AtlasJson.Clone(road);
        moved.Geometry = Spatial.Line([new(0, 50), new(100, 50)]);
        foreach (var features in new[] { new List<Feature>(), new List<Feature> { moved } })
        {
            var output = new GenerationOutput(features, [], [], ["roads"], []);
            var error = Assert.Throws<DomainException>(() => Runner.Merge(world, input, output, Guid.NewGuid()));
            Assert.Equal("attached_connection", error.Code);
        }
    }

    [Fact]
    public void A_following_relation_cannot_move_locked_crossings()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var road = Line(root.Id, "Road", "road", 10);
        var other = Line(root.Id, "Other route", "road", 50);
        world.Features.Add(road.Id, road);
        world.Features.Add(other.Id, other);
        Commands.AddArea(world, new(root.Id, "Locked", Profile.Region, Spatial.Rectangle(20, 0, 60, 80),
            new(new(20, 0)), "manual", []), [], SpatialContractTests.EmptyImpact());
        var edit = AtlasJson.Clone(road);
        edit.Relations = [new(other.Id, "follows")];
        var error = Assert.Throws<DomainException>(() => Commands.Preview(world,
            SpatialContractTests.CommandFor("putFeature", new EditFeature(root.Id, edit), world.Version), "user"));
        Assert.Equal("locked_boundary", error.Code);
    }

    [Fact]
    public void Splitting_a_junction_assigns_distinct_node_identities()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var a = Line(root.Id, "A", "road", 50);
        var b = Line(root.Id, "B", "road", 50);
        a.Geometry = Spatial.Line([new(0, 50), new(50, 50)]);
        b.Geometry = Spatial.Line([new(50, 50), new(100, 50)]);
        world.Features.Add(a.Id, a);
        world.Features.Add(b.Id, b);
        Topology.Rebuild(world);
        a.Geometry = Spatial.Line([new(0, 50), new(40, 40)]);
        b.Geometry = Spatial.Line([new(60, 60), new(100, 50)]);
        Topology.Rebuild(world);
        var reaches = world.NetworkReaches.Values.ToList();
        Assert.NotEqual(reaches.Single(r => r.FeatureId == a.Id).End, reaches.Single(r => r.FeatureId == b.Id).Start);
        foreach (var reach in reaches)
        {
            var coordinates = Spatial.Read(reach.Geometry).Coordinates;
            Assert.Equal(coordinates[0].X, world.NetworkNodes[reach.Start].Position.X);
            Assert.Equal(coordinates[^1].X, world.NetworkNodes[reach.End].Position.X);
        }
    }

    [Fact]
    public void Following_a_different_route_cannot_strand_a_connected_feature()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var road = Line(root.Id, "Road", "road", 10);
        var route = Line(root.Id, "Other", "road", 50);
        world.Features.Add(road.Id, road);
        world.Features.Add(route.Id, route);
        var interior = Commands.AddArea(world, new(root.Id, "Door", Profile.Interior, Spatial.Rectangle(20, 5, 20, 20),
            new(new(25, 10)), "manual", []), [], SpatialContractTests.EmptyImpact());
        var connection = world.Connections.Values.Single();
        world.Connections[connection.Id] = connection with { A = connection.A with { FeatureId = road.Id } };
        Topology.Rebuild(world);
        var edit = AtlasJson.Clone(road);
        edit.Relations = [new(route.Id, "follows")];
        var error = Assert.Throws<DomainException>(() => Commands.Preview(world,
            SpatialContractTests.CommandFor("putFeature", new EditFeature(root.Id, edit), world.Version), "user"));
        Assert.Equal("attached_connection", error.Code);
        Assert.Equal(10, world.Connections[connection.Id].A.Position.Y);
    }

    [Fact]
    public void Reconciliation_includes_new_extents_and_persists_complete_secondary_edits()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var first = Line(root.Id, "First", "river", 10);
        first.Geometry = Spatial.Line([new(0, 10), new(50, 10)]);
        first.Attributes["elevations"] = new System.Text.Json.Nodes.JsonArray(100, 50);
        var second = Line(root.Id, "Second", "river", 10);
        second.Geometry = Spatial.Line([new(50, 10), new(100, 10)]);
        second.Attributes["elevations"] = new System.Text.Json.Nodes.JsonArray(50, 0);
        world.Features.Add(first.Id, first);
        world.Features.Add(second.Id, second);
        var newArea = Commands.AddArea(world, new(root.Id, "New receiving valley", Profile.Region,
            Spatial.Rectangle(60, 40, 30, 30), new(new(60, 40)), "manual", []), [], SpatialContractTests.EmptyImpact());
        Topology.Rebuild(world);
        var additional = AtlasJson.Clone(second);
        additional.Geometry = Spatial.Line([new(50, 10), new(75, 50), new(100, 50)]);
        additional.Attributes["elevations"] = new System.Text.Json.Nodes.JsonArray(50, 25, 0);
        var command = SpatialContractTests.CommandFor("reconcileBoundary", new
        {
            featureId = first.Id,
            geometry = first.Geometry,
            changes = new[] { new EditFeature(root.Id, additional) }
        }, world.Version);
        var result = Commands.Preview(world, command, "user");
        Assert.Contains(newArea.Id, result.Impact.Areas);
        Assert.Equal(3, result.Candidate.Features[second.Id].Attributes["elevations"]!.AsArray().Count);
        Assert.Equal(2, result.Candidate.Areas[newArea.Id].Boundary!.Version);
        var data = AtlasJson.Clone(command.Data);
        data["confirm"] = true;
        data["areaVersions"] = System.Text.Json.JsonSerializer.SerializeToNode(new Dictionary<Guid, long> { [root.Id] = root.Version }, AtlasJson.Options);
        var error = Assert.Throws<DomainException>(() => Commands.Preview(world, command with { Data = data }, "user"));
        Assert.Equal("reconciliation_conflict", error.Code);
    }

    [Fact]
    public void Editing_another_floor_is_rejected_and_route_end_identity_survives_movement()
    {
        var world = SpatialContractTests.MakeWorld();
        var root = world.Areas.Values.Single();
        var lower = Commands.AddArea(world, new(root.Id, "Lower", Profile.Interior, Spatial.Rectangle(10, 10, 30, 30), new(new(10, 10, 0)), "manual", []), [], SpatialContractTests.EmptyImpact());
        var upper = Commands.AddArea(world, new(root.Id, "Upper", Profile.Interior, Spatial.Rectangle(10, 10, 30, 30), new(new(10, 10, 3)), "manual", []), [], SpatialContractTests.EmptyImpact());
        var room = new Feature { Name = "Room", Kind = "room", LayerId = "structures", AreaId = upper.Id, Geometry = Spatial.Rectangle(20, 20, 5, 5) };
        world.Features.Add(room.Id, room);
        var error = Assert.Throws<DomainException>(() => Commands.Preview(world,
            SpatialContractTests.CommandFor("putFeature", new EditFeature(lower.Id, room), world.Version), "user"));
        Assert.Equal("feature_scope", error.Code);
        var road = Line(root.Id, "Road", "road", 70);
        world.Features.Add(road.Id, road);
        Topology.Rebuild(world);
        var start = world.NetworkReaches.Values.Single().Start;
        var edited = AtlasJson.Clone(road);
        edited.Geometry = Spatial.Line([new(10, 65), new(100, 70)]);
        var candidate = Commands.Preview(world, SpatialContractTests.CommandFor("putFeature", new EditFeature(root.Id, edited), world.Version), "user").Candidate;
        Assert.Equal(start, candidate.NetworkReaches.Values.Single().Start);
        Assert.Equal(10, candidate.NetworkNodes[start].Position.X);
    }

    private static Feature Line(Guid area, string name, string kind, double y) => new()
    {
        Name = name,
        Kind = kind,
        LayerId = kind == "river" ? "rivers" : "roads",
        AreaId = area,
        Geometry = Spatial.Line([new(0, y), new(100, y)]),
        Protected = false
    };
}
