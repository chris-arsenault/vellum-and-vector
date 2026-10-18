using Atlas.Domain;
using Atlas.Generation;
using Atlas.Persistence;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Atlas.Api;

public static class Mcp
{
    private static readonly (string Name, string Description)[] Tools = [
        ("list_worlds", "List worlds accessible to the authenticated owner."),
        ("list_templates", "List independent reusable definitions in the authenticated owner's template library."),
        ("save_template", "Save an independent local template definition without creating a world. Pass its current version when updating."),
        ("create_world", "Create a planar metric world from request: name, seed, width and height."),
        ("read_world", "Read the canonical world, layers, areas, entities, history and locked boundary contracts."),
        ("read_features", "Read feature pages using offset and expectedVersion from read_world."),
        ("read_network", "Read network reaches and their endpoint nodes by areaId and optional geometry, offset and expectedVersion in request."),
        ("read_field", "Read a field channel with its dimensions, extent and boundary contract."),
        ("export_world", "Export a GeoJSON page using offset and expectedVersion; retain the declared world CRS."),
        ("undo_change", "Undo the latest committed operation using a versioned command envelope."),
        ("control_job", "Cancel or retry a durable job using jobId and action (cancel or retry)."),
        ("query_features", "Query world features by geometry and area; returns geographically intersecting features."),
        ("analyze_space", "Measure, buffer, intersect, inspect nearby features, field statistics, dependencies, network paths or room circulation using request."),
        ("preview_change", "Validate and preview a versioned domain command without committing it."),
        ("commit_change", "Commit a versioned domain command through the same rules as the editor. Protected content and crossing locks apply."),
        ("start_generation", "Start a durable scoped generation job with explicit domains, seed and quality."),
        ("list_jobs", "Inspect stage, progress, cancellation and failures of server-backed generation jobs.")
    ];

    public static void Map(WebApplication app) => app.MapPost("/mcp", async (JsonObject message, HttpContext context, Store store, Dispatcher dispatcher) =>
    {
        var id = message["id"]?.DeepClone();
        var method = message["method"]?.GetValue<string>();
        if (method == "notifications/initialized") return Results.Accepted();
        object result;
        try
        {
            result = method switch
            {
                "initialize" => new
                {
                    protocolVersion = "2025-03-26",
                    capabilities = new { tools = new { } },
                    serverInfo = new { name = "vellum-and-vector", version = "0.1.0" }
                },
                "ping" => new { },
                "tools/list" => new
                {
                    tools = Tools.Select(t => new
                    {
                        name = t.Name,
                        description = t.Description,
                        inputSchema = new
                        {
                            type = "object",
                            properties = new
                            {
                                worldId = new { type = "string", format = "uuid" },
                                fieldId = new { type = "string", format = "uuid" },
                                channel = new { type = "string" },
                                jobId = new { type = "string", format = "uuid" },
                                action = new { type = "string", @enum = new[] { "cancel", "retry" } },
                                offset = new { type = "integer", minimum = 0 },
                                expectedVersion = new { type = "integer" },
                                command = new { type = "object", description = "operationId, expectedVersion, kind and typed data; see /api/generators and docs/domain-api.md" },
                                query = new { type = "object" },
                                request = new { type = "object" }
                            },
                            required = t.Name is "list_worlds" or "create_world" or "list_templates" or "save_template" ? Array.Empty<string>() : ["worldId"]
                        }
                    })
                },
                "tools/call" => await Call(message["params"]!.AsObject(), (string)context.Items["owner"]!, store, dispatcher),
                _ => throw new DomainException("method_not_found", "Unknown MCP method.")
            };
        }
        catch (DomainException e)
        {
            return Results.Json(new { jsonrpc = "2.0", id, error = new { code = -32602, message = e.Message, data = new { e.Code } } });
        }
        return Results.Json(new { jsonrpc = "2.0", id, result });
    });

    private static async Task<object> Call(JsonObject parameters, string owner, Store store, Dispatcher dispatcher)
    {
        var name = parameters["name"]!.GetValue<string>();
        var args = parameters["arguments"]!.AsObject();
        var worldId = args["worldId"]?.GetValue<Guid>() ?? Guid.Empty;
        var offset = args["offset"]?.GetValue<int>() ?? 0;
        var version = args["expectedVersion"]?.GetValue<long>();
        object data = name switch
        {
            "list_worlds" => await store.ListWorlds(owner),
            "list_templates" => await store.ListTemplates(owner),
            "save_template" => await store.SaveTemplate(AtlasJson.Read<Template>(args["request"]!), owner),
            "create_world" => Payloads.Header(await store.Create(AtlasJson.Read<CreateWorld>(args["request"]!), owner)),
            "read_world" => await Payloads.Metadata(store, worldId, owner),
            "read_features" => await store.Features(worldId, owner, offset, version),
            "read_network" => Payloads.Network(await store.Read(worldId, owner), AtlasJson.Read<Payloads.NetworkQuery>(args["request"]!)),
            "read_field" => await ReadField(),
            "export_world" => Payloads.Export(await store.Read(worldId, owner), offset, version),
            "undo_change" => Payloads.Header(await store.Undo(worldId, owner, AtlasJson.Read<Command>(args["command"]!), $"agent:{owner}")),
            "control_job" => await Control(),
            "query_features" => await Query(),
            "analyze_space" => await store.Analyze(worldId, owner, AtlasJson.Read<AnalysisRequest>(args["request"]!)),
            "preview_change" => Payloads.Proposal(await store.Preview(worldId, owner, AtlasJson.Read<Command>(args["command"]!), $"agent:{owner}")),
            "commit_change" => await Commit(),
            "list_jobs" => await store.Jobs(worldId, owner),
            "start_generation" => await Generate(),
            _ => throw new DomainException("unknown_tool", "Unknown atlas tool.")
        };
        return new { content = new[] { new { type = "text", text = JsonSerializer.Serialize(data, AtlasJson.Options) } } };

        async Task<object> Commit()
        {
            var proposal = await store.Commit(worldId, owner, AtlasJson.Read<Command>(args["command"]!), $"agent:{owner}");
            await dispatcher.EnsureRecipesStarted(proposal, store, owner); return Payloads.Proposal(proposal);
        }

        async Task<object> Query()
        {
            var query = AtlasJson.Read<Endpoints.SpatialQuery>(args["query"]!);
            var world = (await store.Metadata(worldId, owner)).World;
            Guard.Require(version is null || world.Version == version, "version_conflict", "World changed during query; reload its metadata.");
            Guard.Require(offset >= 0, "invalid_page", "Query offsets must be nonnegative.");
            var matches = await store.Query(worldId, owner, query.Geometry, query.AreaId, query.Layer, world.Version);
            var items = matches.Skip(offset).Take(100).ToList();
            return new { items, world.Version, nextOffset = offset + items.Count < matches.Count ? offset + items.Count : (int?)null };
        }
        async Task<object> ReadField()
        {
            await store.Metadata(worldId, owner);
            var field = (await store.ReadFields(worldId, [args["fieldId"]!.GetValue<Guid>()])).SingleOrDefault();
            var channel = args["channel"]!.GetValue<string>();
            Guard.Require(field is not null && field.Values.ContainsKey(channel), "not_found", "Field or channel not found.");
            return new
            {
                field!.Id,
                field.AreaId,
                field.Bounds,
                field.Width,
                field.Height,
                channel,
                field.Boundary,
                humanHistory = field.HumanHistory?.Select(h => new { h.Era, h.Events, channels = h.Surface.Values.Keys }),
                values = Enumerable.Range(0, field.Width * field.Height).Select(i => field.Sample(channel, field.PositionAt(i % field.Width, i / field.Width)))
            };
        }
        async Task<object> Control()
        {
            var action = args["action"]!.GetValue<string>();
            Guard.Require(action is "cancel" or "retry", "invalid_action", "Choose cancel or retry.");
            var jobId = args["jobId"]!.GetValue<Guid>();
            await store.ControlJob(worldId, jobId, owner, action == "retry");
            var job = (await store.Jobs(worldId, owner)).Single(j => j.Id == jobId);
            if (action == "retry") await dispatcher.EnsureStarted(job);
            return job;
        }
        async Task<object> Generate()
        {
            var job = await store.Enqueue(worldId, owner, AtlasJson.Read<GenerationRequest>(args["request"]!));
            await dispatcher.EnsureStarted(job);
            return job;
        }
    }
}
