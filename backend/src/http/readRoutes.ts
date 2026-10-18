import { z } from "zod";
import { spatialQuerySchema, requireThat } from "@atlas/domain";
import { readWorldHeader } from "../dal/worldHeader";
import { ancestorIds, readAreas } from "../dal/areaReader";
import { readFeatures, readEntities } from "../dal/objectReaders";
import { queryAreaPage } from "../dal/areaPages";
import { querySpatialPage } from "../dal/spatialRows";
import { queryNetworkPage } from "../dal/networkPages";
import { validateCommittedScope } from "../dal/scopedReads";
import { ok, type Route, type RouteServices } from "./routes";
import { ownedRead, worldPath, requestedVersion, queryPage } from "./ownedReads";

export function readRoutes(services: RouteServices): Route[] {
  return [
    ...worldReadRoutes(services),
    ...objectReadRoutes(services),
    ...spatialReadRoutes(services),
  ];
}
function worldReadRoutes({ database }: RouteServices): Route[] {
  return [
    {
      method: "GET",
      path: /^\/api\/worlds\/([^/]+)$/,
      async handle(request, context, match) {
        const world = worldPath(match);
        return ok(
          await ownedRead(
            database,
            world,
            context.principal.owner,
            requestedVersion(request),
            async (sql, version) => {
              const header = await readWorldHeader(sql, world, version),
                root = await sql.query<{ id: string }>(
                  "SELECT id FROM atlas_areas WHERE scope_id=$1 AND parent_id IS NULL AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)",
                  [world, version]
                );
              return { world: header, rootAreaId: root.rows[0]?.id ?? null };
            }
          )
        );
      },
    },
    {
      method: "GET",
      path: /^\/api\/worlds\/([^/]+)\/areas$/,
      async handle(request, context, match) {
        const world = worldPath(match),
          page = queryPage(request);
        return ok(
          await ownedRead(
            database,
            world,
            context.principal.owner,
            requestedVersion(request),
            (sql, version) => queryAreaPage(sql, world, version, page)
          )
        );
      },
    },
  ];
}
function objectReadRoutes({ database }: RouteServices): Route[] {
  return [
    {
      method: "GET",
      path: /^\/api\/worlds\/([^/]+)\/areas\/([^/]+)$/,
      async handle(request, context, match) {
        const world = worldPath(match),
          area = z.uuid().parse(match[2]);
        return ok(
          await ownedRead(
            database,
            world,
            context.principal.owner,
            requestedVersion(request),
            async (sql, version) => {
              const rows = await readAreas(
                sql,
                world,
                version,
                await ancestorIds(sql, world, version, area)
              );
              requireThat(rows.objects[area], "not_found", "Mapped area not found.");
              return { version, area: rows.objects[area], ancestors: Object.values(rows.objects) };
            }
          )
        );
      },
    },
    {
      method: "GET",
      path: /^\/api\/worlds\/([^/]+)\/(features|entities)\/([^/]+)$/,
      async handle(request, context, match) {
        const world = worldPath(match),
          id = z.uuid().parse(match[3]);
        return ok(
          await ownedRead(
            database,
            world,
            context.principal.owner,
            requestedVersion(request),
            async (sql, version) => {
              const rows =
                match[2] === "features"
                  ? await readFeatures(sql, world, version, [id])
                  : await readEntities(sql, world, version, [id]);
              requireThat(rows.objects[id], "not_found", "Domain object not found.");
              return { version, object: rows.objects[id] };
            }
          )
        );
      },
    },
  ];
}
function spatialReadRoutes({ database }: RouteServices): Route[] {
  return [
    {
      method: "POST",
      path: /^\/api\/worlds\/([^/]+)\/features\/query$/,
      async handle(request, context, match) {
        const world = worldPath(match),
          input = spatialQuerySchema.parse(request.body);
        requireThat(
          input.scope.worldId === world,
          "operation_scope",
          "The spatial query must identify this world."
        );
        return ok(
          await ownedRead(
            database,
            world,
            context.principal.owner,
            input.scope.revision,
            async (sql) => {
              await validateCommittedScope(sql, input.scope);
              return querySpatialPage(sql, input.scope, input.layers, input.page);
            }
          )
        );
      },
    },
    {
      method: "POST",
      path: /^\/api\/worlds\/([^/]+)\/network\/(node|reach|connection)\/query$/,
      async handle(request, context, match) {
        const world = worldPath(match),
          input = spatialQuerySchema.parse(request.body),
          kind = z.enum(["node", "reach", "connection"]).parse(match[2]);
        requireThat(
          input.scope.worldId === world,
          "operation_scope",
          "The network query must identify this world."
        );
        return ok(
          await ownedRead(
            database,
            world,
            context.principal.owner,
            input.scope.revision,
            async (sql) => {
              await validateCommittedScope(sql, input.scope);
              return queryNetworkPage(sql, input.scope, kind, input.page);
            }
          )
        );
      },
    },
  ];
}
