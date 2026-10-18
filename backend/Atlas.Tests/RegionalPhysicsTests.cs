using Atlas.Domain;
using Atlas.Generation;
using System.Text.Json;
using Xunit;

namespace Atlas.Tests;

public class RegionalPhysicsTests
{
    [Fact]
    public void Underfilled_pools_do_not_exchange_water_across_a_dry_saddle()
    {
        var (world, area, source) = Basin();
        var input = new GenerationInput(world, new(Guid.NewGuid(), world.Version, area.Id, ["physical"], 17, "draft"), [source]);
        var grid = new RegionalGrid(input, Guid.NewGuid(), source, null);
        for (var i = 0; i < grid.Count; i++)
        {
            var p = grid.Position(i);
            grid["elevation"][i] = !grid.Mutable[i] ? 10 : Math.Abs(p.X - 500) < grid.Dx ? 5 : 0;
            grid["surfaceStorage"][i] = 0;
        }
        RegionalHydrology.Route(grid);
        var left = grid.Reservoirs.Values.Where(r => grid.Position(r.Root).X < 490).OrderByDescending(r => r.Cells.Count).First();
        var incoming = new double[grid.Count];
        incoming[left.Root] = grid.CellArea;
        SurfaceReservoirs.FillAll(grid, incoming, new double[grid.Count], 1);
        Assert.Contains(left.Cells, i => grid["surfaceStorage"][i] > 0);
        Assert.All(Enumerable.Range(0, grid.Count).Where(i => grid.Interior[i] && grid.Position(i).X > 520),
            i => Assert.Equal(0, grid["surfaceStorage"][i], 8));
        Assert.InRange(Enumerable.Range(0, grid.Count).Sum(i => grid["surfaceStorage"][i] * grid.Measures[i]) - grid.CellArea, -1e-5, 1e-5);
    }

    [Fact]
    public async Task A_native_world_refines_a_located_watercourse_with_its_existing_interfaces()
    {
        var world = Commands.NewWorld(new("Native watershed", 41, 100000, 100000), "local");
        var root = world.Areas.Values.Single();
        var request = new GenerationRequest(Guid.NewGuid(), world.Version, root.Id, ["physical"], 41, "draft");
        var input = new GenerationInput(world, request, []);
        var generated = await Runner.Run(input, Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        world = Runner.Merge(world, input, generated, Guid.NewGuid());
        var physical = generated.Fields.Single();
        Assert.True(world.Features.Values.Any(f => f.Kind == "river"),
            $"No rivers: land samples={physical.Values["water"].Count(v => v == 0)}, flow max={physical.Values["flow"].Max()}, elevation range={physical.Values["elevation"].Min()}..{physical.Values["elevation"].Max()}");
        var river = world.Features.Values.Where(f => f.Kind == "river")
            .OrderByDescending(f => Spatial.Read(f.Geometry).Length).First();
        var center = Spatial.Read(river.Geometry).Centroid.Coordinate;
        var x = Math.Clamp(center.X - 5000, 0, 90000); var y = Math.Clamp(center.Y - 5000, 0, 90000);
        var area = Commands.AddArea(world, new(root.Id, "Refined river", Profile.Region, Spatial.Rectangle(x, y, 10000, 10000),
            new(new(x, y)), "procedural", ["physical"]), generated.Fields, SpatialContractTests.EmptyImpact());
        var regional = new GenerationInput(world, request with { AreaId = area.Id, ExpectedVersion = world.Version }, generated.Fields);
        var result = await Runner.Run(regional, Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        var merged = Runner.Merge(world, regional, result, Guid.NewGuid());
        foreach (var crossing in area.Boundary!.Crossings)
        {
            var feature = Composition.ForArea(merged, merged.Features[crossing.FeatureId], area.Id)!;
            Assert.InRange(Spatial.Read(feature.Geometry).Distance(Spatial.Point(crossing.Point)), 0, 1e-5);
        }
        Assert.NotEmpty(result.Fields.Single().Budgets!);
    }

    [Fact]
    public async Task Root_hard_relief_and_cold_constraints_shape_the_native_physical_state()
    {
        var world = Commands.NewWorld(new("Cold plain", 41, 100000, 100000,
            [new("relief", TraitKind.Hard, 0, 40), new("temperature", TraitKind.Hard, 0, 200)]), "local");
        var root = world.Areas.Values.Single();
        var input = new GenerationInput(world, new(Guid.NewGuid(), world.Version, root.Id, ["physical"], 41, "draft"), []);
        var output = await Runner.Run(input, Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        var field = output.Fields.Single();
        Assert.True(field.Values["elevation"].Max() - field.Values["elevation"].Min() <= 40.01);
        Assert.All(field.Values["temperature"], value => Assert.InRange(value, 0, 200));
        foreach (var epoch in field.History!)
            Assert.All(epoch.Surface.Values["temperature"], value => Assert.InRange(value, 0, 200));
        for (var i = 0; i < field.Values["elevation"].Length; i++)
            Assert.Equal(field.Values["elevation"][i], field.Values["bedrock"][i] + field.Values["sediment"][i], 6);
        Runner.Merge(world, input, output, Guid.NewGuid());
    }

    [Fact]
    public async Task A_closed_depression_retains_supplied_water_and_material_budgets_close()
    {
        var (world, area, source) = Basin();
        var input = new GenerationInput(world, new(Guid.NewGuid(), world.Version, area.Id, ["physical"], 17, "draft"), [source]);
        var output = await Runner.Run(input, Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        var field = output.Fields.Single();
        Assert.Contains(field.Values["surfaceStorage"], value => value > .05);
        Assert.Contains(output.Features, f => f.Kind == "lake" && f.Attributes["storage"]!.GetValue<double>() > 0);
        foreach (var budget in field.Budgets!)
        {
            Assert.Equal(budget.Rain + budget.Inflow, budget.Evaporation + budget.Outflow + budget.GroundwaterChange + budget.SurfaceStorageChange + budget.IceChange, 5);
            Assert.Equal(budget.SedimentProduced, budget.SedimentDeposited + budget.SedimentExported + budget.SedimentStorageChange, 5);
        }
        Assert.All(field.History!, epoch => Assert.Contains("bedrock", epoch.Surface.Values.Keys));
        Runner.Merge(world, input, output, Guid.NewGuid());
    }

    [Fact]
    public async Task An_authored_subgrid_ridge_shapes_climate_and_survives_resolution_changes_without_replaying_history()
    {
        var (world, area, source) = Basin();
        var bounds = Spatial.Bounds(area.Footprint);
        var original = new FieldData(Guid.NewGuid(), area.Id, bounds, 8, 8,
            source.Values.ToDictionary(k => k.Key, k => Enumerable.Repeat(k.Key == "elevation" || k.Key == "bedrock" ? 100d : k.Value[0], 64).ToArray()),
            "test", 1);
        original = original with { History = [new(world.Epochs[0], new(bounds, 8, 8, AtlasJson.Clone(original.Values)), [])] };
        world.Fields.Add(new(original.Id, area.Id, "elevation", "test", Guid.NewGuid(), 64, original.Values.Keys.ToList()));
        area.Layers["elevation"] = Materialization.Generated;
        var request = new GenerationRequest(Guid.NewGuid(), world.Version, area.Id, ["physical"], 2, "draft");
        var plain = await Runner.Run(new(world, request, [source, original]), Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        var sculpt = SpatialContractTests.CommandFor("sculptField", new Sculpt(area.Id, "elevation", new(500, 500), 150, 400), world.Version);
        var authored = Commands.Preview(world, sculpt, "user", [source, original]);
        var ridge = authored.Artifacts!.Single();
        var refined = await Runner.Run(new(authored.Candidate, request with { ExpectedVersion = authored.Candidate.Version, Quality = "standard" }, [source, ridge]),
            Guid.NewGuid(), (_, _) => Task.CompletedTask, CancellationToken.None);
        var final = refined.Fields.Single();
        Assert.Equal(ridge.Sample("elevation", new(500, 500)), final.Sample("elevation", new(500, 500)), 8);
        Assert.NotEqual(plain.Fields.Single().Sample("rainfall", new(500, 500)), final.Sample("rainfall", new(500, 500)));
        Assert.Equal(JsonSerializer.Serialize(original.History, AtlasJson.Options), JsonSerializer.Serialize(final.History, AtlasJson.Options));
    }

    [Fact]
    public void Polygon_holes_use_their_own_interface_profile_and_do_not_change_interior_samples()
    {
        var outer = Spatial.Read(Spatial.Rectangle(0, 0, 100, 100));
        var hole = Spatial.Read(Spatial.Rectangle(40, 40, 20, 20));
        var footprint = Spatial.Write(outer.Difference(hole));
        var rings = Composition.Parts(Spatial.Read(footprint).Boundary).Select((ring, index) => ring.Coordinates.Take(ring.Coordinates.Length - 1)
            .Select(p => new FieldSample(new(p.X, p.Y), new() { ["elevation"] = index == 0 ? 10 : 100 })).ToList()).ToList();
        var field = new FieldData(Guid.NewGuid(), Guid.NewGuid(), [0, 0, 100, 100], 2, 2,
            new() { ["elevation"] = [3, 3, 3, 3] }, "test", 1, new(footprint, rings.SelectMany(r => r).ToList(), rings));
        Assert.Equal(10, field.Sample("elevation", new(0, 50)));
        Assert.Equal(100, field.Sample("elevation", new(40, 50)));
        Assert.Equal(3, field.Sample("elevation", new(20, 50)), 10);
    }

    [Fact]
    public void A_new_confluence_accounts_for_incoming_flow_before_downstream_infiltration()
    {
        var world = SpatialContractTests.MakeWorld();
        var area = world.Areas.Values.Single();
        var river = SpatialContractTests.River(area.Id);
        river.Geometry = Spatial.Line([new(50, 0), new(50, 50), new(50, 100)]);
        river.Attributes = new()
        {
            ["flow"] = 10,
            ["discharges"] = new System.Text.Json.Nodes.JsonArray(10d, 15d, 10d),
            ["junctionInflows"] = new System.Text.Json.Nodes.JsonArray(0d, 5d, 0d),
            ["elevations"] = new System.Text.Json.Nodes.JsonArray(100d, 50d, 0d)
        };
        var branch = new Feature
        {
            Name = "Branch",
            AreaId = area.Id,
            Kind = "river",
            LayerId = "rivers",
            Geometry = Spatial.Line([new(0, 50), new(50, 50)]),
            Attributes = new() { ["flow"] = 5, ["elevations"] = new System.Text.Json.Nodes.JsonArray(80d, 50d) }
        };
        world.Features.Add(river.Id, river); world.Features.Add(branch.Id, branch);
        Topology.Rebuild(world);
        var junction = world.NetworkNodes.Values.Single(n => n.Position.X == 50 && n.Position.Y == 50);
        Assert.Equal(15, world.NetworkReaches.Values.Where(r => r.End == junction.Id).Sum(r => r.EndFlow ?? r.Flow));
        Assert.Equal(15, world.NetworkReaches.Values.Single(r => r.Start == junction.Id).Flow);
        Assert.Equal(10, world.NetworkReaches.Values.Single(r => r.Start == junction.Id).EndFlow);
    }

    private static (World World, Area Area, FieldData Field) Basin()
    {
        var world = Commands.NewWorld(new("Basin", 17, 1000, 1000), "local");
        world.Epochs = [new("wet", Tectonics: 0, Ice: 0)];
        var root = world.Areas.Values.Single();
        var values = new Dictionary<string, double[]>();
        foreach (var (key, value) in new[] { ("elevation", 0d), ("bedrock", 0d), ("rainfall", 1000d), ("temperature", 400d),
            ("moisture", 500d), ("rock", 500d), ("fracture", 0d), ("ice", 0d), ("glacialHistory", 0d), ("windX", 1000d) }) values[key] = Enumerable.Repeat(value, 81).ToArray();
        for (var y = 0; y < 9; y++)
            for (var x = 0; x < 9; x++) values["elevation"][y * 9 + x] = values["bedrock"][y * 9 + x] = (Math.Pow(x - 4, 2) + Math.Pow(y - 4, 2)) * 5 + 10;
        var field = new FieldData(Guid.NewGuid(), root.Id, [0, 0, 1000, 1000], 9, 9, values, "test", 1);
        world.Fields.Add(new(field.Id, root.Id, "elevation", "test", Guid.NewGuid(), 81, values.Keys.ToList()));
        root.Layers["elevation"] = root.Layers["climate"] = Materialization.Generated;
        var area = Commands.AddArea(world, new(root.Id, "Watershed", Profile.Region, Spatial.Rectangle(100, 100, 800, 800),
            new(new(100, 100)), "procedural", ["physical"]), [field], SpatialContractTests.EmptyImpact());
        return (world, area, field);
    }
}
