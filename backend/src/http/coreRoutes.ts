import { z } from "zod";
import {
  createWorldBlueprint,
  worldCreationSchema,
  intentSchema,
  readRequirementsSchema,
  profiles,
} from "@atlas/domain";
import { WorldRepository } from "../dal/worlds";
import { ProjectionRepository } from "../dal/projections";
import { OperationRepository } from "../dal/operations";
import { UndoRepository } from "../dal/undo";
import { ok, type Route, type RouteServices } from "./routes";
import { worldPath, queryPage } from "./ownedReads";

const createSchema = z.object({ operationId: z.uuid(), world: worldCreationSchema });
const undoSchema = z.object({
  operationId: z.uuid(),
  target: z.uuid(),
  reads: readRequirementsSchema,
  confirmed: z.boolean().optional(),
});
export function coreRoutes(services: RouteServices): Route[] {
  return [...catalogRoutes(services), ...commandRoutes(services)];
}
function catalogRoutes({ database, intents }: RouteServices): Route[] {
  return [
    {
      method: "GET",
      path: /^\/api\/operations$/,
      async handle() {
        return ok(intents.registry.describe());
      },
    },
    {
      method: "GET",
      path: /^\/api\/profiles$/,
      async handle() {
        return ok(profiles);
      },
    },
    {
      method: "GET",
      path: /^\/api\/worlds$/,
      async handle(_request, context) {
        return ok(await new WorldRepository(database).list(context.principal.owner));
      },
    },
    {
      method: "POST",
      path: /^\/api\/worlds$/,
      async handle(request, context) {
        const input = createSchema.parse(request.body),
          blueprint = createWorldBlueprint(input.world);
        const operation = await new WorldRepository(database).create(
          context.principal.owner,
          input.operationId,
          blueprint
        );
        return ok({ operation, worldId: blueprint.id, rootAreaId: blueprint.root.id }, 201);
      },
    },
  ];
}
function commandRoutes({ database, intents }: RouteServices): Route[] {
  return [
    {
      method: "POST",
      path: /^\/api\/worlds\/([^/]+)\/query$/,
      async handle(request, context, match) {
        return ok(
          await new ProjectionRepository(database).read(
            worldPath(match),
            context.principal.owner,
            readRequirementsSchema.parse(request.body)
          )
        );
      },
    },
    {
      method: "POST",
      path: /^\/api\/worlds\/([^/]+)\/intents\/(preview|validate|commit)$/,
      async handle(request, context, match) {
        const world = worldPath(match),
          input = intentSchema.parse(request.body);
        return ok(
          match[2] === "commit"
            ? await intents.commit(world, context.principal.owner, input, context.actor)
            : await intents.preview(world, context.principal.owner, input, context.actor)
        );
      },
    },
    {
      method: "GET",
      path: /^\/api\/worlds\/([^/]+)\/history$/,
      async handle(request, context, match) {
        return ok(
          await new OperationRepository(database).history(
            worldPath(match),
            context.principal.owner,
            queryPage(request)
          )
        );
      },
    },
    {
      method: "GET",
      path: /^\/api\/worlds\/([^/]+)\/operations\/([^/]+)$/,
      async handle(_request, context, match) {
        return ok(
          await new OperationRepository(database).inspect(
            worldPath(match),
            context.principal.owner,
            z.uuid().parse(match[2])
          )
        );
      },
    },
    {
      method: "POST",
      path: /^\/api\/worlds\/([^/]+)\/undo$/,
      async handle(request, context, match) {
        const input = undoSchema.parse(request.body);
        return ok(
          await new UndoRepository(database).undo(
            worldPath(match),
            context.principal.owner,
            input.operationId,
            input.target,
            input.reads,
            { actor: context.actor, confirmed: input.confirmed }
          )
        );
      },
    },
  ];
}
