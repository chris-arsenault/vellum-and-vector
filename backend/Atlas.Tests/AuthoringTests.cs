using Atlas.Domain;
using Xunit;

namespace Atlas.Tests;

public class AuthoringTests
{
    [Fact]
    public void Changing_a_culture_marks_derived_human_geography_stale_and_preserves_authored_layers()
    {
        var world = SpatialContractTests.MakeWorld(); var area = world.Areas.Values.Single();
        area.Layers["cultures"] = area.Layers["sovereignty"] = Materialization.Generated;
        area.Layers["structures"] = Materialization.Authored;
        var entity = new Entity(Guid.NewGuid(), "New people", "culture", new() { ["initialPopulation"] = 100 }, []);
        var proposal = Commands.Preview(world, SpatialContractTests.CommandFor("putEntity", entity, world.Version), "user");
        Assert.Equal(Materialization.Stale, proposal.Candidate.Areas[area.Id].Layers["cultures"]);
        Assert.Equal(Materialization.Stale, proposal.Candidate.Areas[area.Id].Layers["sovereignty"]);
        Assert.Equal(Materialization.Authored, proposal.Candidate.Areas[area.Id].Layers["structures"]);
        Assert.Contains(area.Id, proposal.Impact.Areas);
    }

    [Fact]
    public void Routed_roads_are_authored_networks_and_analysis_follows_their_connected_path()
    {
        var world = SpatialContractTests.MakeWorld(); var area = world.Areas.Values.Single();
        var routed = Commands.Preview(world, SpatialContractTests.CommandFor("routeNetwork", new RouteNetwork(area.Id, "road", "Market road", [new(10, 10), new(50, 10), new(90, 10)]), world.Version), "user");
        var road = Assert.Single(routed.Candidate.Features.Values);
        Assert.Equal(Materialization.Authored, road.State); Assert.NotEmpty(routed.Candidate.NetworkReaches);
        var target = new Feature { Name = "Market", Kind = "poi", LayerId = "pois", AreaId = area.Id, Geometry = Spatial.Write(Spatial.Point(new(90, 10))) };
        routed.Candidate.Features.Add(target.Id, target);
        var analysis = SpatialAnalysis.Run(routed.Candidate, new(area.Id, "networkPath", Geometry: Spatial.Write(Spatial.Point(new(10, 10))), TargetFeatureId: target.Id), []);
        Assert.Equal(80, analysis.Measurements["length_m"], 6); Assert.Contains(road.Id, analysis.Features);
        Assert.Equal(routed.Candidate.Version, analysis.WorldVersion);
        var measured = SpatialAnalysis.Run(world, new(area.Id, "measure", Spatial.Rectangle(10, 10, 20, 30)), []);
        Assert.Equal(600, measured.Measurements["area_m2"]); Assert.Equal(100, measured.Measurements["perimeter_m"]);
    }
}
