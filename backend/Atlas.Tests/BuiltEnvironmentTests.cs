using Atlas.Domain;
using Atlas.Generation;
using Xunit;

namespace Atlas.Tests;

public class BuiltEnvironmentTests
{
    [Fact]
    public async Task A_site_has_frontage_parcels_building_access_and_connected_interior_rooms()
    {
        var world = Commands.NewWorld(new("Located buildings", 12, 1000, 1000), "local");
        var root = world.Areas.Values.Single();
        var site = Commands.AddArea(world, new(root.Id, "Town site", Profile.Site, Spatial.Rectangle(100, 100, 100, 80), new(new(100, 100)), "manual", ["built"]), [], SpatialContractTests.EmptyImpact());
        var request = new GenerationRequest(Guid.NewGuid(), world.Version, site.Id, ["built"], 12, "draft");
        var input = new GenerationInput(world, request, []);
        var generated = await Runner.Run(input, Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        world = Runner.Merge(world, input, generated, Guid.NewGuid());
        Assert.Contains(generated.Features, f => f.Kind == "parcel");
        var building = generated.Features.First(f => f.Kind == "building");
        var door = generated.Features.Single(f => f.Kind == "door" && f.Relations.Any(r => r.TargetId == building.Id));
        Assert.True(Networks.ReachesRoad(world, door.Id));
        var bounds = Spatial.Bounds(building.Geometry);
        var interior = Commands.AddArea(world, new(site.Id, "Tavern interior", Profile.Interior, building.Geometry, new(new(bounds[0], bounds[1]), Floor: "ground"),
            "manual", ["built"], Context: "structure", ContextFeatureId: building.Id), [], SpatialContractTests.EmptyImpact());
        var entry = world.Connections.Values.Single();
        Assert.Equal(door.Id, entry.A.FeatureId);
        var layoutInput = new GenerationInput(world, request with { AreaId = interior.Id, ExpectedVersion = world.Version }, []);
        var layout = await Runner.Run(layoutInput, Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        Assert.Contains(layout.Features, f => f.Kind == "wall");
        Assert.Contains(layout.Features, f => f.Kind == "furniture");
        var rooms = layout.Features.Where(f => f.Kind == "room").ToList();
        var reachable = new HashSet<Guid> { layout.Features.Single(f => f.Kind == "door" && f.Relations.Any(r => r.Kind == "access")).Relations.First(r => r.Kind == "connects").TargetId };
        while (true)
        {
            var before = reachable.Count;
            foreach (var passage in layout.Features.Where(f => f.Kind == "door" && f.Relations.Any(r => reachable.Contains(r.TargetId))))
                reachable.UnionWith(passage.Relations.Where(r => r.Kind == "connects").Select(r => r.TargetId));
            if (before == reachable.Count) break;
        }
        Assert.All(rooms, room => Assert.Contains(room.Id, reachable));
        Runner.Merge(world, layoutInput, layout, Guid.NewGuid());
    }

    [Fact]
    public void Template_definition_units_entities_and_required_access_bind_to_real_context()
    {
        var world = Commands.NewWorld(new("Template placement", 12, 100, 100), "local"); var root = world.Areas.Values.Single();
        var site = Commands.AddArea(world, new(root.Id, "Site", Profile.Site, world.Reference.Domain, new(new(0, 0)), "manual", []), [], SpatialContractTests.EmptyImpact());
        var building = new Feature { Name = "Building", Kind = "building", LayerId = "structures", AreaId = site.Id, Geometry = Spatial.Rectangle(30, 30, 30, 30) };
        var target = new Feature { Name = "Door", Kind = "door", LayerId = "structures", AreaId = site.Id, Geometry = Spatial.Write(Spatial.Point(new(30, 40))) };
        var street = new Feature { Name = "Street", Kind = "road", LayerId = "roads", AreaId = site.Id, Geometry = Spatial.Line([new(0, 40), new(30, 40)]), Relations = [new(target.Id, "connects")] };
        world.Features.Add(building.Id, building); world.Features.Add(target.Id, target); world.Features.Add(street.Id, street);
        var owner = new Entity(Guid.NewGuid(), "Tavern guild", "institution", [], []);
        var room = new Feature { Name = "Hall", Kind = "room", LayerId = "structures", AreaId = Guid.Empty, Geometry = Spatial.Rectangle(0, 0, 20, 10), Relations = [new(owner.Id, "owner")] };
        var door = new Feature { Name = "Local door", Kind = "door", LayerId = "structures", AreaId = Guid.Empty, Geometry = Spatial.Write(Spatial.Point(new(0, 5))), Relations = [new(room.Id, "connects")] };
        var template = new Template(Guid.NewGuid(), "Tavern", Profile.Interior, [Profile.Site], room.Geometry, [room, door], [], new(new(2, 0), MetresPerUnit: .3048),
            Units: "foot", Entities: [owner], Sockets: [new("entry", door.Id, new(0, 5), Required: true, TargetKinds: ["door"])], Requirements: new(["building"], StreetAccess: true));
        Templates.Save(world, template);
        Templates.Instantiate(world, new(template.Id, site.Id, "Placed tavern", new(new(28, 38.476)), building.Id, new() { ["entry"] = target.Id }), "user", [], SpatialContractTests.EmptyImpact());
        var placed = world.Areas.Values.Single(a => a.TemplateId == template.Id);
        Assert.Equal(6.096, Spatial.Bounds(placed.Footprint)[2] - Spatial.Bounds(placed.Footprint)[0], 6);
        var actualRoom = world.Features.Values.Single(f => f.AreaId == placed.Id && f.Kind == "room");
        Assert.NotEqual(owner.Id, actualRoom.Relations.Single().TargetId);
        Assert.Contains(actualRoom.Relations.Single().TargetId, world.Entities.Keys);
        Assert.Equal(target.Id, world.Connections.Values.Single().A.FeatureId);
        Assert.Equal(Guid.Empty, world.Templates[template.Id].Features[0].AreaId);
    }
}
