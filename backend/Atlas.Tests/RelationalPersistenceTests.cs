using Atlas.Domain;
using Atlas.Generation;
using Atlas.Persistence;
using System.Text.Json;
using System.Text.Json.Nodes;
using Testcontainers.PostgreSql;
using Xunit;

namespace Atlas.Tests;

public partial class PersistenceTests
{
    [Fact]
    public async Task Typed_fields_history_and_custom_attributes_survive_restart_and_pinned_job_reads()
    {
        await using var database = new PostgreSqlBuilder().WithImage("postgis/postgis:16-3.5").Build();
        await database.StartAsync(); await using var source = await DatabaseSource(database.GetConnectionString());
        var store = new Store(source);
        var world = await store.Create(new("Typed storage", 17, 100, 100), "alice");
        var area = world.Areas.Values.Single(); var field = DetailedField(area.Id);
        var feature = new Feature
        {
            Name = "Survey", Kind = "poi", AreaId = area.Id, LayerId = "pois", Geometry = Spatial.Write(Spatial.Point(new(25, 25))),
            Attributes = new()
            {
                ["center"] = new JsonObject { ["x"] = 25, ["y"] = 25 },
                ["history"] = new JsonArray(new JsonObject { ["era"] = "present", ["cause"] = null }),
                ["hypsometry"] = new JsonArray(new JsonObject { ["floor"] = 2, ["area"] = 10 }),
                ["waterExchange"] = new JsonObject { ["note"] = "surveyed" },
                ["outletPath"] = new JsonArray(1, 2),
                ["widths"] = new JsonArray(1d, 2d, 3d),
                ["epochHistory"] = new JsonArray(new JsonArray(), new JsonArray(new JsonObject
                { ["epoch"] = "present", ["dissolution"] = 1, ["collapse"] = 2, ["deposition"] = 3, ["iceDamage"] = 4 })),
                ["custom"] = new JsonObject { ["empty"] = new JsonObject(), ["array"] = new JsonArray(true, null, "x", new JsonArray()), ["amount"] = JsonNode.Parse("12345678901234567890.123456789") }
            }
        };
        var job = await store.Enqueue(world.Id, "alice", new(Guid.NewGuid(), world.Version, area.Id, ["physical"], 17, "draft"));
        var lease = (await store.Claim(job.Id))!;
        await store.Publish(lease, new([feature], [], [field], ["elevation"], [], field.Transfers));
        var reloaded = await new Store(source).Read(world.Id, "alice");
        Assert.True(JsonNode.DeepEquals(feature.Attributes, reloaded.Features[feature.Id].Attributes), $"Expected {feature.Attributes}; actual {reloaded.Features[feature.Id].Attributes}");
        var storedField = Assert.Single(await store.ReadFields(world.Id, [field.Id]));
        Assert.True(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(field, AtlasJson.Options), JsonSerializer.SerializeToNode(storedField, AtlasJson.Options)),
            $"Expected {JsonSerializer.Serialize(field, AtlasJson.Options)}; actual {JsonSerializer.Serialize(storedField, AtlasJson.Options)}");
        var queued = await store.Enqueue(world.Id, "alice", new(Guid.NewGuid(), reloaded.Version, area.Id, ["built"], 18, "draft"));
        feature.Name = "Edited survey";
        var edited = await store.Commit(world.Id, "alice", SpatialContractTests.CommandFor("putFeature", new EditFeature(area.Id, feature), reloaded.Version), "user:alice");
        var pinned = (await new Store(source).Claim(queued.Id))!;
        Assert.Equal("Survey", pinned.Input.World.Features[feature.Id].Name);
        Assert.Equal("Edited survey", edited.Candidate.Features[feature.Id].Name);
        Assert.Single(pinned.Input.Fields); Assert.Single(pinned.Input.Fields[0].HumanHistory!);
        await using var noDocuments = source.CreateCommand("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'atlas_%' AND data_type IN ('json','jsonb','bytea')");
        Assert.Equal(0L, await noDocuments.ExecuteScalarAsync());
        await using var revisions = source.CreateCommand("SELECT count(*) FROM atlas_features WHERE scope_id=$1 AND id=$2");
        revisions.Parameters.AddWithValue(world.Id); revisions.Parameters.AddWithValue(feature.Id);
        Assert.Equal(2L, await revisions.ExecuteScalarAsync());
    }

    [Fact]
    public async Task World_bound_template_relations_and_optional_definition_shapes_round_trip()
    {
        await using var database = new PostgreSqlBuilder().WithImage("postgis/postgis:16-3.5").Build();
        await database.StartAsync(); await using var source = await DatabaseSource(database.GetConnectionString());
        var store = new Store(source); var world = await store.Create(new("Context", 1, 100, 100), "alice");
        var entity = new Entity(Guid.NewGuid(), "Guild", "culture", [], []);
        var withEntity = await store.Commit(world.Id, "alice", SpatialContractTests.CommandFor("putEntity", entity, world.Version), "user:alice");
        var room = new Feature { Name = "Hall", Kind = "room", LayerId = "structures", AreaId = Guid.Empty, Geometry = Spatial.Rectangle(0, 0, 10, 10), Relations = [new(entity.Id, "ownedBy")] };
        var definition = new Template(Guid.NewGuid(), "Guildhall", Profile.Interior, [Profile.Site], room.Geometry, [room], [], new(new(0, 0)), Entities: [], Sockets: []);
        var result = await store.Commit(world.Id, "alice", SpatialContractTests.CommandFor("saveTemplate", definition, withEntity.Candidate.Version), "user:alice");
        var saved = (await store.Read(world.Id, "alice")).Templates[definition.Id];
        Assert.True(JsonNode.DeepEquals(JsonSerializer.SerializeToNode(definition, AtlasJson.Options), JsonSerializer.SerializeToNode(saved, AtlasJson.Options)), $"Expected {JsonSerializer.Serialize(definition, AtlasJson.Options)}; actual {JsonSerializer.Serialize(saved, AtlasJson.Options)}");
        Assert.Equal(entity.Id, saved.Features[0].Relations[0].TargetId);
        Assert.Equal(result.Candidate.Version, (await store.Read(world.Id, "alice")).Version);
    }

    private static FieldData DetailedField(Guid area)
    {
        var bounds = new double[] { 0, 0, 100, 100 };
        var values = new Dictionary<string, double[]> { ["elevation"] = [10, 20, 30, 40], ["moisture"] = [.1, .2, .3, .4] };
        var body = new WaterBodyState(Guid.NewGuid(), Spatial.Rectangle(20, 20, 10, 10), [new(0, 50), new(1, 100, Spatial.Rectangle(20, 20, 10, 10), .25)], 20, 5,
            new(30, 25), new(29, 25), .5, null, [new(29, 25), new(30, 25)]);
        var surface = new SampledPatch(bounds, 2, 2, values, [body]);
        var samples = new List<FieldSample> { new(new(0, 0), new() { ["elevation"] = 10 }), new(new(100, 0), new() { ["elevation"] = 20 }) };
        var links = new List<FlowLink> { new(Guid.NewGuid(), new(0, 0), new(100, 100), 2, true) };
        var epoch = new Epoch("present"); var transfer = new WaterTransfer(Guid.NewGuid(), new(30, 25), 2, body.Id, Guid.NewGuid());
        return new(Guid.NewGuid(), area, bounds, 2, 2, values, "fixture-v1", 17,
            new(Spatial.Rectangle(0, 0, 100, 100), samples, [samples]),
            [new(Guid.NewGuid(), Spatial.Rectangle(0, 0, 10, 10), ["elevation"], "user:alice", surface)],
            [new(epoch, surface, [Guid.NewGuid()], links)], [new("present", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)], surface,
            [transfer], links, [25, 25, 25, 25], [body], [new(new("settlement", 200, "present"), surface, [new("settlement", Guid.NewGuid(), new(25, 25), 50, [Guid.NewGuid()])])]);
    }
}
