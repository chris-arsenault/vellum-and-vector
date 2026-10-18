using Amazon.Lambda.AspNetCoreServer.Hosting;
using Atlas.Api;
using Atlas.Domain;
using Atlas.Persistence;
using Npgsql;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options =>
{
    foreach (var converter in AtlasJson.Options.Converters) options.SerializerOptions.Converters.Add(converter);
});
builder.Services.AddSingleton(_ => Database.Create());
builder.Services.AddSingleton<Store>();
builder.Services.AddSingleton<Worker>();
builder.Services.AddSingleton<Dispatcher>();
builder.Services.AddAWSLambdaHosting(LambdaEventSource.ApplicationLoadBalancer);
var app = builder.Build();

if (args.Contains("--worker"))
{
    var job = Guid.TryParse(Environment.GetEnvironmentVariable("JOB_ID"), out var id) ? id : (Guid?)null;
    await app.Services.GetRequiredService<Worker>().Run(job, CancellationToken.None);
    return;
}

app.Use(async (context, next) =>
{
    try
    {
        var origin = Environment.GetEnvironmentVariable("ATLAS_ORIGIN");
        if (origin is not null && context.Request.Headers.Origin == origin)
        {
            context.Response.Headers.AccessControlAllowOrigin = origin;
            context.Response.Headers.Vary = "Origin";
            context.Response.Headers.AccessControlAllowHeaders = "Authorization, Content-Type, X-Atlas-Actor";
            context.Response.Headers.AccessControlAllowMethods = "GET, POST, OPTIONS";
        }
        if (context.Request.Method == "OPTIONS") { context.Response.StatusCode = 204; return; }
        if (context.Request.Path != "/health") context.Items["owner"] = Identity.Owner(context, app.Environment);
        await next();
    }
    catch (DomainException e)
    {
        context.Response.StatusCode = e.Code switch
        {
            "not_found" => 404,
            "unauthorized" => 401,
            "version_conflict" or "idempotency_conflict" or "generation_conflict" => 409,
            _ => 422
        };
        await context.Response.WriteAsJsonAsync(new { code = e.Code, message = e.Message });
    }
    catch (Exception e) when (e is JsonException or FormatException or KeyNotFoundException or InvalidOperationException or ArgumentException)
    {
        context.Response.StatusCode = 400;
        await context.Response.WriteAsJsonAsync(new { code = "invalid_request", message = "Request data is incomplete or malformed." });
    }
});
app.MapGet("/health", () => new { status = "ok", service = "vellum-and-vector" });
Endpoints.Map(app);
Mcp.Map(app);
if (Environment.GetEnvironmentVariable("ATLAS_RUN_WORKER") == "1")
{
    Guard.Require(app.Environment.IsDevelopment() && Environment.GetEnvironmentVariable("AWS_LAMBDA_FUNCTION_NAME") is null,
        "worker_mode", "In-process workers are for local development; deployed generation uses separate workers.");
    _ = Task.Run(() => app.Services.GetRequiredService<Worker>().Run(null, app.Lifetime.ApplicationStopping));
}
await app.RunAsync();

namespace Atlas.Api
{
    public static class Database
    {
        public static NpgsqlDataSource Create()
        {
            var provided = Environment.GetEnvironmentVariable("DATABASE_URL");
            if (provided is not null) return AtlasDatabase.Create(provided);
            string Required(string key) => Environment.GetEnvironmentVariable(key) ?? throw new InvalidOperationException($"{key} is required.");
            var builder = new NpgsqlConnectionStringBuilder
            {
                Host = Required("DB_HOST"),
                Port = int.Parse(Environment.GetEnvironmentVariable("DB_PORT") ?? "5432"),
                Username = Required("DB_USERNAME"),
                Password = Required("DB_PASSWORD"),
                Database = Required("DB_NAME"),
                SslMode = SslMode.VerifyFull,
                RootCertificate = CertificateBundle()
            };
            return AtlasDatabase.Create(builder.ConnectionString);
        }

        private static string CertificateBundle()
        {
            var path = Path.Combine(Path.GetTempPath(), "vellum-rds-global-bundle.pem");
            using var resource = typeof(Database).Assembly.GetManifestResourceStream("Atlas.Api.certs.rds-global-bundle.pem")
                ?? throw new InvalidOperationException("The embedded RDS CA bundle is missing.");
            using var output = File.Create(path);
            resource.CopyTo(output);
            return path;
        }
    }
}
