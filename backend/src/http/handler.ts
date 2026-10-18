import { randomUUID } from "node:crypto";
import { DomainError, createIntentRegistry } from "@atlas/domain";
import { IntentService } from "../intentService";
import type { Database } from "../dal/database";
import { coreRoutes } from "./coreRoutes";
import { readRoutes } from "./readRoutes";
import { analysisRoutes } from "./analysisRoutes";
import { normalize, cors, preflight, errorResult, respond } from "./transport";
import { identity } from "./identity";
import type { AlbEvent, HttpConfig } from "./types";

export function createHttpHandler(
  database: Database,
  config: HttpConfig,
  intents = new IntentService(database, createIntentRegistry())
) {
  const services = { database, intents },
    routes = [...coreRoutes(services), ...readRoutes(services), ...analysisRoutes(services)];
  return async (event: AlbEvent, invocation?: { awsRequestId?: string }) => {
    const requestId = invocation?.awsRequestId ?? randomUUID();
    let extraHeaders: Record<string, string> = {};
    try {
      const request = normalize(event, requestId);
      extraHeaders = cors(request, config);
      const options = preflight(request, config);
      if (options) return respond(options);
      if (request.method === "GET" && request.path === "/health")
        return respond({ status: 200, body: { status: "ok" } }, extraHeaders);
      const context = identity(request, config);
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = request.path.match(route.path);
        if (match) return respond(await route.handle(request, context, match), extraHeaders);
      }
      throw new DomainError("route_not_found", "This API operation is unavailable.");
    } catch (error) {
      return respond(errorResult(error, requestId), extraHeaders);
    }
  };
}
