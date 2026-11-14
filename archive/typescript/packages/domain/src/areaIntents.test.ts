import { expect, it } from "vitest";
import { registerAreaIntents } from "./areaIntents";
import { FactDependencies } from "./factDependencies";
import { IntentRegistry, type IntentContext } from "./intent";
import { rectangle } from "./spatial";
import { valueRecordSchema } from "./schemas";

it("keeps a regional creation scoped to its source while its new map includes surrounding context", () => {
  const registry = new IntentRegistry();
  registerAreaIntents(registry);
  const scope = {
      worldId: crypto.randomUUID(),
      areaId: crypto.randomUUID(),
      spaceId: crypto.randomUUID(),
      crsId: "planar",
      revision: 1,
      time: "present" as const,
      resolution: null,
      footprint: rectangle([100, 100, 900, 900]),
    },
    context: IntentContext = {
      scope,
      owner: "owner",
      actor: "user",
      operationId: crypto.randomUUID(),
      layers: [],
      fields: [],
      facts: new FactDependencies(),
    },
    operation = registry.bind(
      {
        operationId: context.operationId,
        expectedVersion: 1,
        version: 1,
        kind: "createArea",
        scope,
        data: valueRecordSchema.parse({
          id: crypto.randomUUID(),
          regionId: crypto.randomUUID(),
          parentId: scope.areaId,
          name: "Finer map",
          profile: "region",
          footprint: rectangle([50, 50, 950, 950]),
          frame: { origin: { x: 500, y: 500, z: 0 }, rotation: 0, metresPerUnit: 1, floor: null },
          approach: "procedural",
          layers: [],
          traits: [],
        }),
      },
      context
    );
  expect(operation.requirements.scope).toEqual(scope);
});
