using Atlas.Domain;
using Atlas.Generation;
using Atlas.Persistence;
using Npgsql;
using Testcontainers.PostgreSql;
using Xunit;

namespace Atlas.Tests;

public partial class PersistenceTests
{
    [Fact]
    public async Task Commands_are_atomic_idempotent_owner_scoped_and_undoable()
    {
        await using var database = new PostgreSqlBuilder().WithImage("postgis/postgis:16-3.5").Build();
        await database.StartAsync();
        await using var source = await DatabaseSource(database.GetConnectionString());
        var store = new Store(source);
        var world = await store.Create(new("Persistent world", 1, 100, 100), "alice");
        var root = world.Areas.Values.Single();
        var feature = new Feature
        {
            Name = "Marker",
            Kind = "poi",
            LayerId = "pois",
            AreaId = root.Id,
            Geometry = Spatial.Write(Spatial.Point(new(30, 30)))
        };
        var command = SpatialContractTests.CommandFor("putFeature", new EditFeature(root.Id, feature), world.Version);
        var preview = await store.Preview(world.Id, "alice", command, "user:alice");
        Assert.Single(preview.Candidate.Features);
        Assert.Empty((await store.Read(world.Id, "alice")).Features);
        var saved = await store.Commit(world.Id, "alice", command, "user:alice");
        var repeated = await store.Commit(world.Id, "alice", command, "user:alice");
        Assert.Equal(saved.Candidate.Version, repeated.Candidate.Version);
        Assert.Single(await store.Query(world.Id, "alice", Spatial.Rectangle(20, 20, 20, 20), root.Id));
        await Assert.ThrowsAsync<DomainException>(() => store.Read(world.Id, "bob"));
        var bad = SpatialContractTests.CommandFor("putFeature", new EditFeature(root.Id, feature), world.Version);
        await Assert.ThrowsAsync<DomainException>(() => store.Commit(world.Id, "alice", bad, "user:alice"));
        Assert.Equal(2, (await store.Read(world.Id, "alice")).Version);
        var undo = SpatialContractTests.CommandFor("undo", new { operationId = command.OperationId }, saved.Candidate.Version);
        var protectedUndo = await Assert.ThrowsAsync<DomainException>(() => store.Undo(world.Id, "alice", undo, "agent:alice"));
        Assert.Equal("protected_operation", protectedUndo.Code);
        var restored = await store.Undo(world.Id, "alice", undo, "user:alice");
        Assert.Empty(restored.Features);
        Assert.Equal(3, restored.Version);
        Assert.Equal(2, (await store.History(world.Id, "alice")).Count);
        var route = new Feature
        {
            Name = "Route",
            Kind = "road",
            LayerId = "roads",
            AreaId = root.Id,
            Geometry = Spatial.Line([new(0, 50), new(100, 50)]),
            Protected = false
        };
        var routeResult = await store.Commit(world.Id, "alice", SpatialContractTests.CommandFor("putFeature", new EditFeature(root.Id, route), restored.Version), "user:alice");
        var border = new Feature
        {
            Name = "Bound frontier",
            Kind = "border",
            LayerId = "claims",
            AreaId = root.Id,
            Geometry = Spatial.Line([new(0, 10), new(100, 10)]),
            Relations = [new(route.Id, "follows")]
        };
        var bound = await store.Commit(world.Id, "alice", SpatialContractTests.CommandFor("putFeature", new EditFeature(root.Id, border), routeResult.Candidate.Version), "user:alice");
        var indexed = await store.Query(world.Id, "alice", Spatial.Rectangle(20, 49, 20, 2), root.Id);
        Assert.Contains(indexed, item => item.Id == border.Id);
        var marker = await store.Commit(world.Id, "alice", SpatialContractTests.CommandFor("putFeature", new EditFeature(root.Id, feature), bound.Candidate.Version), "user:alice");
        await using var row = source.CreateCommand("SELECT xmin::text FROM atlas_feature_index WHERE world_id=$1 AND feature_id=$2");
        row.Parameters.AddWithValue(world.Id); row.Parameters.AddWithValue(feature.Id);
        var unchanged = await row.ExecuteScalarAsync();
        route.Geometry = Spatial.Line([new(0, 60), new(100, 60)]);
        await store.Commit(world.Id, "alice", SpatialContractTests.CommandFor("putFeature", new EditFeature(root.Id, route), marker.Candidate.Version), "user:alice");
        Assert.Equal(unchanged, await row.ExecuteScalarAsync());
        var moved = await store.Query(world.Id, "alice", Spatial.Rectangle(20, 59, 20, 2), root.Id);
        Assert.Contains(moved, item => item.Id == border.Id);
        Assert.DoesNotContain(await store.Query(world.Id, "alice", Spatial.Rectangle(20, 49, 20, 2), root.Id), item => item.Id == border.Id);
    }

    [Fact]
    public async Task Jobs_survive_store_restart_and_cancel_without_publishing_artifacts()
    {
        await using var database = new PostgreSqlBuilder().WithImage("postgis/postgis:16-3.5").Build();
        await database.StartAsync();
        await using var source = await DatabaseSource(database.GetConnectionString());
        var store = new Store(source);
        var world = await store.Create(new("Jobs", 1, 100, 100), "alice");
        var root = world.Areas.Values.Single();
        var request = new GenerationRequest(Guid.NewGuid(), world.Version, root.Id, ["built"], 42, "draft");
        var job = await store.Enqueue(world.Id, "alice", request);
        Assert.Equal(job.Id, (await store.Enqueue(world.Id, "alice", request)).Id);
        var restarted = new Store(source);
        var lease = await restarted.Claim(job.Id);
        Assert.NotNull(lease);
        Assert.Null(await restarted.Claim(job.Id));
        await restarted.ControlJob(world.Id, job.Id, "alice", false);
        Assert.True(await restarted.Heartbeat(lease!, "Building", 0.3));
        var result = await Runner.Run(lease!.Input, job.Id, (_, _) => Task.CompletedTask, CancellationToken.None);
        await Assert.ThrowsAsync<DomainException>(() => restarted.Publish(lease, result));
        Assert.Empty((await restarted.Read(world.Id, "alice")).Features);
        await restarted.Fail(lease, "Cancelled", true);
        await restarted.ControlJob(world.Id, job.Id, "alice", true);
        var retried = await restarted.Claim(job.Id);
        Assert.Equal(2, retried!.Job.Attempt);
        var final = await Runner.Run(retried.Input, job.Id, (_, _) => Task.CompletedTask, CancellationToken.None);
        await restarted.Publish(retried, final);
        Assert.NotEmpty((await restarted.Read(world.Id, "alice")).Features);
        Assert.Equal("completed", (await restarted.Jobs(world.Id, "alice")).Single().Status);
    }

    [Fact]
    public async Task Independent_template_definitions_keep_instances_detached_and_queue_their_recipes_atomically()
    {
        await using var database = new PostgreSqlBuilder().WithImage("postgis/postgis:16-3.5").Build();
        await database.StartAsync(); await using var source = await DatabaseSource(database.GetConnectionString());
        var store = new Store(source);
        var room = new Feature { Name = "Hall", Kind = "room", LayerId = "structures", AreaId = Guid.Empty, Geometry = Spatial.Rectangle(0, 0, 10, 10) };
        var definition = new Template(Guid.NewGuid(), "Detached hall", Profile.Interior, [Profile.Site], room.Geometry, [room], [], new(new(0, 0)), Recipe: new(["built"], Quality: "draft"));
        var saved = await store.SaveTemplate(definition, "alice");
        Assert.Single(await store.ListTemplates("alice")); Assert.Empty(await store.ListTemplates("bob"));
        var world = await store.Create(new("Placement world", 1, 100, 100), "alice"); var root = world.Areas.Values.Single();
        var siteResult = await store.Commit(world.Id, "alice", SpatialContractTests.CommandFor("createArea", new CreateArea(root.Id, "Site", Profile.Site, Spatial.Rectangle(10, 10, 80, 80), new(new(10, 10)), "manual", []), world.Version), "user:alice");
        var site = siteResult.Candidate.Areas.Values.Single(a => a.Profile == Profile.Site);
        var operation = SpatialContractTests.CommandFor("instantiateTemplate", new Instantiate(saved.Id, site.Id, "Placed hall", new(new(20, 20)), DefinitionVersion: saved.Version), siteResult.Candidate.Version);
        var placed = await store.Commit(world.Id, "alice", operation, "user:alice");
        var area = placed.Candidate.Areas.Values.Single(a => a.TemplateId == saved.Id);
        var job = Assert.Single(await store.Jobs(world.Id, "alice")); Assert.Equal(area.RecipeJobId, job.Id);
        var repeated = await store.Commit(world.Id, "alice", operation, "user:alice"); Assert.Equal(placed.Candidate.Version, repeated.Candidate.Version);
        Assert.Single(await store.Jobs(world.Id, "alice"));
        var updated = await store.SaveTemplate(saved with { Name = "Updated definition" }, "alice"); Assert.Equal(2, updated.Version);
        var unchanged = await store.Read(world.Id, "alice"); Assert.Equal("Detached hall", unchanged.Templates[saved.Id].Name);
        var lease = (await store.Claim(job.Id))!;
        var output = await Runner.Run(lease.Input, job.Id, (_, _) => Task.CompletedTask, CancellationToken.None);
        await store.Publish(lease, output);
        Assert.Contains((await store.Read(world.Id, "alice")).Features.Values, f => f.AreaId == area.Id && f.Kind == "wall");
    }

    private static async Task<NpgsqlDataSource> DatabaseSource(string connectionString)
    {
        await using var source = NpgsqlDataSource.Create(connectionString);
        // Administrator setup is confined to this disposable test database.
        // Production extension installation is a manual operator prerequisite.
        await using var extensions = source.CreateCommand("CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS btree_gist");
        await extensions.ExecuteNonQueryAsync();
        var directory = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../..", "db/migrations"));
        foreach (var path in Directory.GetFiles(directory, "*.sql").Order())
        {
            await using var command = source.CreateCommand(await File.ReadAllTextAsync(path));
            await command.ExecuteNonQueryAsync();
        }
        return AtlasDatabase.Create(connectionString);
    }
}
