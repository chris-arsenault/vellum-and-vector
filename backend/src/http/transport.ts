import { randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";
import { DomainError, requireThat } from "@atlas/domain";
import { ZodError } from "zod";
import type { AlbEvent, AlbResult, HttpRequest, HttpResult, HttpConfig } from "./types";

function headers(event: AlbEvent): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    const name = key.toLowerCase();
    requireThat(
      !Object.hasOwn(result, name),
      "invalid_headers",
      "Header names must be unambiguous."
    );
    if (value !== undefined) result[name] = value;
  }
  for (const [key, values] of Object.entries(event.multiValueHeaders ?? {})) {
    if (!values?.length) continue;
    requireThat(
      values.length === 1,
      "invalid_headers",
      "This API expects one value for each request header."
    );
    const name = key.toLowerCase();
    requireThat(
      result[name] === undefined || result[name] === values[0],
      "invalid_headers",
      "Header names must be unambiguous."
    );
    result[name] = values[0];
  }
  return result;
}
function queryParameters(event: AlbEvent) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(event.queryStringParameters ?? {}))
    if (value !== undefined) query.set(key, value);
  for (const [key, values] of Object.entries(event.multiValueQueryStringParameters ?? {})) {
    if (!values?.length) continue;
    query.delete(key);
    for (const value of values) query.append(key, value);
  }
  return query;
}
function requestBody(event: AlbEvent): unknown {
  if (!event.body) return null;
  try {
    return JSON.parse(
      event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body
    );
  } catch {
    throw new DomainError("invalid_json", "Request body must be valid JSON.");
  }
}
export function normalize(event: AlbEvent, requestId: string = randomUUID()): HttpRequest {
  requireThat(
    event.requestContext?.elb?.targetGroupArn,
    "untrusted_transport",
    "This entrypoint accepts the platform ALB Lambda event."
  );
  return {
    method: event.httpMethod.toUpperCase(),
    path: event.path,
    headers: headers(event),
    query: queryParameters(event),
    body: requestBody(event),
    requestId,
  };
}
export function cors(request: HttpRequest, config: HttpConfig): Record<string, string> {
  return request.headers.origin === config.origin
    ? { "access-control-allow-origin": config.origin, vary: "Origin" }
    : {};
}
export function preflight(request: HttpRequest, config: HttpConfig): HttpResult | null {
  if (request.method !== "OPTIONS") return null;
  requireThat(
    request.headers.origin === config.origin,
    "forbidden",
    "This origin is not configured for the editor."
  );
  return {
    status: 204,
    body: null,
    headers: {
      ...cors(request, config),
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, x-atlas-actor",
      "access-control-max-age": "600",
    },
  };
}
export function errorResult(error: unknown, requestId: string): HttpResult {
  if (error instanceof ZodError)
    return {
      status: 400,
      body: {
        code: "invalid_request",
        message: "Request inputs do not match the domain contract.",
        details: error.issues,
        requestId,
      },
    };
  if (error instanceof DomainError)
    return {
      status: errorStatus(error.code),
      body: { code: error.code, message: error.message, details: error.details, requestId },
    };
  return {
    status: 500,
    body: { code: "internal_error", message: "The operation could not be completed.", requestId },
  };
}
function errorStatus(code: string): number {
  if (code === "unauthorized") return 401;
  if (code === "forbidden") return 403;
  if (code === "not_found" || code === "route_not_found") return 404;
  if (code === "auth_configuration" || code === "untrusted_transport") return 500;
  if (
    [
      "stale_version",
      "revision_conflict",
      "idempotency_conflict",
      "artifact_conflict",
      "undo_conflict",
    ].includes(code)
  )
    return 409;
  if (["invalid_json", "invalid_headers", "invalid_page", "invalid_query"].includes(code))
    return 400;
  return 422;
}
export function respond(result: HttpResult, extraHeaders: Record<string, string> = {}): AlbResult {
  return {
    statusCode: result.status,
    statusDescription: `${result.status} ${STATUS_CODES[result.status] ?? "Unknown"}`,
    isBase64Encoded: false,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
      ...result.headers,
    },
    body:
      result.status === 204
        ? ""
        : JSON.stringify(result.body, (_key, value) =>
            ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<number>) : value
          ),
  };
}
