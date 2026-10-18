import { z } from "zod";
import { requireThat } from "@atlas/domain";
import { Database, ownedVersion, type Sql } from "../dal/database";
import type { HttpRequest } from "./types";

export const worldPath = (match: RegExpMatchArray) => z.uuid().parse(match[1]);
export function requestedVersion(request: HttpRequest): number | undefined {
  const raw = request.query.get("version");
  return raw === null ? undefined : z.coerce.number().int().positive().parse(raw);
}
export function queryPage(request: HttpRequest) {
  return {
    offset: z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(request.query.get("offset") ?? "0"),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .parse(request.query.get("limit") ?? "100"),
  };
}
export function ownedRead<T>(
  database: Database,
  world: string,
  owner: string,
  requested: number | undefined,
  work: (sql: Sql, version: number) => Promise<T>
) {
  return database.transaction(async (sql) => {
    const current = await ownedVersion(sql, world, owner),
      version = requested ?? current;
    requireThat(version <= current, "invalid_revision", "This world revision is unavailable.");
    return work(sql, version);
  }, true);
}
