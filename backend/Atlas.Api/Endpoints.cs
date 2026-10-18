using Atlas.Domain;
using Atlas.Generation;
using Atlas.Persistence;
using System.Text.Json.Nodes;

namespace Atlas.Api;

public static class Endpoints
{
    private static string Owner(HttpContext context) => (string)context.Items["owner"]!;

    public static void Map(WebApplication app)
    {
        app.MapGet("/api/worlds", (HttpContext c, Store s) => s.ListWorlds(Owner(c)));
        app.MapGet("/api/templates", (HttpContext c, Store s) => s.ListTemplates(Owner(c)));
        app.MapPost("/api/templates", (Template definition, HttpContext c, Store s) => s.SaveTemplate(definition, Owner(c)));
        app.MapPost("/api/worlds", (CreateWorld input, HttpContext c, Store s) => s.Create(input, Owner(c)));
        app.MapGet("/api/profiles", () => Enum.GetNames<Profile>());
        app.MapGet("/api/generators", () => Registry.All);
        var worlds = app.MapGroup("/api/worlds/{id:guid}");
        worlds.MapGet("", (Guid id, HttpContext c, Store s) => Payloads.Metadata(s, id, Owner(c)));
        worlds.MapGet("/features", (Guid id, int? offset, long? expectedVersion, HttpContext c, Store s) => s.Features(id, Owner(c), offset ?? 0, expectedVersion));
        worlds.MapGet("/features/{featureId:guid}", (Guid id, Guid featureId, Guid? areaId, HttpContext c, Store s) => s.Feature(id, Owner(c), featureId, areaId));
        worlds.MapGet("/scene", async (Guid id, Guid areaId, string? extent, int? offset, long? expectedVersion, HttpContext c, Store s) =>
        {
            var world = (await s.Metadata(id, Owner(c))).World;
            Guard.Require(world.Areas.ContainsKey(areaId), "missing_area", "Choose a mapped area.");
            Guard.Require(expectedVersion is null || world.Version == expectedVersion, "version_conflict", "Read the current world before loading this scene.");
            var scope = Spatial.Read(world.Areas[areaId].Footprint);
            if (extent is not null)
            {
                var box = extent.Split(',').Select(v => double.TryParse(v, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var value) ? value : double.NaN).ToArray();
                Guard.Require(box.Length == 4 && box.All(double.IsFinite) && box[0] < box[2] && box[1] < box[3], "invalid_extent", "Extent must contain finite minX,minY,maxX,maxY coordinates.");
                scope = scope.Intersection(Spatial.Read(Spatial.Rectangle(box[0], box[1], box[2] - box[0], box[3] - box[1])));
            }
            if (scope.IsEmpty) return new { items = new List<Feature>(), world.Version, nextOffset = (int?)null };
            var matches = await s.Query(id, Owner(c), Spatial.Write(scope), areaId, expectedVersion: world.Version);
            var start = offset ?? 0;
            Guard.Require(start >= 0, "invalid_page", "Scene offsets must be nonnegative.");
            var items = matches.Skip(start).Take(100).ToList();
            return new { items, world.Version, nextOffset = start + items.Count < matches.Count ? start + items.Count : (int?)null };
        });
        worlds.MapGet("/sample", async (Guid id, Guid areaId, string channel, double x, double y, HttpContext c, Store s) =>
        {
            var world = (await s.Metadata(id, Owner(c))).World;
            Guard.Require(world.Areas.ContainsKey(areaId), "missing_area", "Choose a mapped area.");
            var fields = await s.ReadFields(id, world.Fields.Where(f => f.Channels?.Contains(channel) != false).Select(f => f.Id));
            var point = new Position(x, y);
            var field = FieldComposition.At(world, fields, areaId, channel, point);
            Guard.Require(field is not null, "unmaterialized_field", "No materialized field covers this position and space.");
            return new { fieldId = field!.Id, channel, point, value = field.Sample(channel, point), world.Version };
        });
        worlds.MapGet("/history", (Guid id, HttpContext c, Store s) => s.History(id, Owner(c)));
        worlds.MapPost("/preview", async (Guid id, Command input, HttpContext c, Store s) => Payloads.Proposal(await s.Preview(id, Owner(c), input, Identity.Actor(c))));
        worlds.MapPost("/commands", async (Guid id, Command input, HttpContext c, Store s, Dispatcher dispatcher) =>
        {
            var proposal = await s.Commit(id, Owner(c), input, Identity.Actor(c));
            await dispatcher.EnsureRecipesStarted(proposal, s, Owner(c));
            return Payloads.Proposal(proposal);
        });
        worlds.MapPost("/undo", async (Guid id, Command input, HttpContext c, Store s) => Payloads.Header(await s.Undo(id, Owner(c), input, Identity.Actor(c))));
        worlds.MapPost("/query", (Guid id, SpatialQuery input, HttpContext c, Store s) => s.Query(id, Owner(c), input.Geometry, input.AreaId, input.Layer));
        worlds.MapPost("/analyze", (Guid id, AnalysisRequest input, HttpContext c, Store s) => s.Analyze(id, Owner(c), input));
        worlds.MapPost("/network", async (Guid id, Payloads.NetworkQuery input, HttpContext c, Store s) => Payloads.Network(await s.Read(id, Owner(c)), input));
        worlds.MapGet("/jobs", (Guid id, HttpContext c, Store s) => s.Jobs(id, Owner(c)));
        worlds.MapPost("/jobs", async (Guid id, GenerationRequest input, HttpContext c, Store s, Dispatcher dispatcher) =>
        {
            var job = await s.Enqueue(id, Owner(c), input);
            await dispatcher.EnsureStarted(job);
            return Results.Accepted($"/api/worlds/{id}/jobs", job);
        });
        worlds.MapPost("/jobs/{jobId:guid}/{action}", async (Guid id, Guid jobId, string action, HttpContext c, Store s, Dispatcher dispatcher) =>
        {
            Guard.Require(action is "cancel" or "retry", "invalid_action", "Choose cancel or retry.");
            await s.ControlJob(id, jobId, Owner(c), action == "retry");
            if (action == "retry") await dispatcher.EnsureStarted((await s.Jobs(id, Owner(c))).Single(j => j.Id == jobId));
            return Results.NoContent();
        });
        worlds.MapGet("/fields/{fieldId:guid}", async (Guid id, Guid fieldId, string channel, HttpContext c, Store s) =>
        {
            var world = (await s.Metadata(id, Owner(c))).World;
            var field = (await s.ReadFields(id, [fieldId])).SingleOrDefault();
            Guard.Require(field is not null && field.Values.ContainsKey(channel), "not_found", "Field or channel not found.");
            var values = Enumerable.Range(0, field!.Width * field.Height).Select(i => field.Sample(channel, field.PositionAt(i % field.Width, i / field.Width))).ToArray();
            return new
            {
                field.Id,
                field.AreaId,
                field.Bounds,
                field.Width,
                field.Height,
                channel,
                values,
                humanHistory = field.HumanHistory?.Select(h => new { h.Era, h.Events, channels = h.Surface.Values.Keys }),
                footprint = FieldComposition.Coverage(world, field, channel),
                sourceFootprint = world.Areas[field.AreaId].Footprint
            };
        });
        worlds.MapGet("/fields/{fieldId:guid}/channels", async (Guid id, Guid fieldId, HttpContext c, Store s) =>
        {
            await s.Metadata(id, Owner(c));
            return (await s.ReadFields(id, [fieldId])).Single().Values.Keys;
        });
        worlds.MapGet("/fields/{fieldId:guid}/history", async (Guid id, Guid fieldId, HttpContext c, Store s) =>
        {
            await s.Metadata(id, Owner(c));
            var field = (await s.ReadFields(id, [fieldId])).SingleOrDefault();
            Guard.Require(field is not null, "not_found", "Field not found.");
            return new { physical = field!.History?.Select(h => new { h.Epoch, h.Forcing }), human = field.HumanHistory?.Select(h => new { h.Era, h.Events }) };
        });
        worlds.MapPost("/convert", async (Guid id, CoordinateQuery input, HttpContext c, Store s) =>
        {
            var world = (await s.Metadata(id, Owner(c))).World;
            var frame = world.Areas[input.AreaId].Frame;
            return input.Direction == "toWorld" ? frame.ToWorld(input.Position) : frame.FromWorld(input.Position);
        });
        worlds.MapGet("/export", async (Guid id, int? offset, long? expectedVersion, HttpContext c, Store s) => Payloads.Export(await s.Read(id, Owner(c)), offset ?? 0, expectedVersion));
    }

    public sealed record SpatialQuery(Guid AreaId, JsonObject Geometry, string? Layer = null);
    public sealed record CoordinateQuery(Guid AreaId, Position Position, string Direction);
}
