import type { Database } from "../dal/database";
import type { HttpRequest, HttpResult, RequestContext } from "./types";
export interface Route {
  method: string;
  path: RegExp;
  handle(
    request: HttpRequest,
    context: RequestContext,
    match: RegExpMatchArray
  ): Promise<HttpResult>;
}
export interface RouteServices {
  database: Database;
  intents: import("../intentService").IntentService;
}
export const ok = (body: unknown, status = 200): HttpResult => ({ status, body });
