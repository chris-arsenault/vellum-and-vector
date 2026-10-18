using Atlas.Domain;
using System.Text;
using System.Text.Json.Nodes;

namespace Atlas.Api;

public static class Identity
{
    public static string Owner(HttpContext context, IHostEnvironment environment)
    {
        var lambda = Environment.GetEnvironmentVariable("AWS_LAMBDA_FUNCTION_NAME") is not null;
        if (!lambda && environment.IsDevelopment() && Environment.GetEnvironmentVariable("ATLAS_AUTH_MODE") == "local")
        {
            Guard.Require(context.Connection.RemoteIpAddress is { } address && System.Net.IPAddress.IsLoopback(address),
                "unauthorized", "Local authentication accepts loopback requests only.");
            return "local";
        }
        // The Lambda may only be invoked by the JWT-validating shared ALB.
        Guard.Require(lambda, "unauthorized", "User authentication requires the platform ALB boundary.");
        var header = context.Request.Headers.Authorization.ToString();
        Guard.Require(header.StartsWith("Bearer ", StringComparison.Ordinal), "unauthorized", "A bearer token is required.");
        var parts = header[7..].Split('.');
        Guard.Require(parts.Length == 3, "unauthorized", "The validated bearer token is malformed.");
        var payload = parts[1].Replace('-', '+').Replace('_', '/');
        payload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
        var claims = JsonNode.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(payload)))!;
        var sub = claims["sub"]?.GetValue<string>();
        Guard.Require(!string.IsNullOrWhiteSpace(sub), "unauthorized", "The validated token needs a subject.");
        return sub!;
    }

    public static string Actor(HttpContext context) => context.Request.Headers["X-Atlas-Actor"].ToString() == "agent"
        ? $"agent:{context.Items["owner"]}" : $"user:{context.Items["owner"]}";
}
