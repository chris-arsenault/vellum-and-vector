import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createIntentRegistry, type Intent, type ParameterValues } from "@atlas/domain";
import { testDatabase } from "./testDatabase";
import { Database } from "./dal/database";
import { seedSpatialWorld } from "./dal/spatialFixtures";
import { readFeatures } from "./dal/objectReaders";
import { IntentService } from "./intentService";

type Fixture = Awaited<ReturnType<typeof seedSpatialWorld>>;
function riverEdit({ world, child, feature }: Fixture): Intent {
  return {
    operationId: randomUUID(),
    expectedVersion: 1,
    version: 1,
    kind: "putFeature",
    scope: {
      worldId: world.id,
      areaId: child.id,
      spaceId: world.id,
      footprint: child.footprint,
      crsId: world.reference.id,
      revision: 1,
      time: "present",
      resolution: null,
    },
    data: {
      areaId: child.id,
      feature: {
        id: feature.id,
        name: "Authored valley river",
        kind: "river",
        layerId: "rivers",
        geometry: {
          type: "LineString",
          coordinates: [
            [20, 50],
            [35, 40],
            [65, 60],
            [80, 50],
          ],
        },
        attributes: { elevations: [80, 65, 35, 20], discharges: [10, 10, 10, 10] },
        relations: [],
      },
    },
  };
}

it("previews and commits one locked-interface refinement through the real shared authoring contract", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      fixture = await database.transaction(seedSpatialWorld);
    const registry = createIntentRegistry(),
      service = new IntentService(database, registry);
    expect(registry.describe().find((d) => d.kind === "putFeature")?.schema).toHaveProperty(
      "properties"
    );
    const intent = riverEdit(fixture),
      preview = await service.preview(fixture.world.id, "alice", intent);
    const operation = await service.commit(fixture.world.id, "alice", intent);
    expect(operation.version).toBe(2);
    const stored = (await readFeatures(db.client, fixture.world.id, 2, [fixture.feature.id]))
      .objects[fixture.feature.id];
    expect(stored).toEqual(preview.candidate.features[fixture.feature.id]);
    expect(stored.detail[fixture.child.id].protected).toBe(true);
    expect(stored.geometry).toEqual(fixture.feature.geometry);
    expect(await service.commit(fixture.world.id, "alice", intent)).toEqual(operation);
    await expect(service.commit(fixture.world.id, "bob", intent)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      service.commit(fixture.world.id, "alice", { ...intent, operationId: randomUUID() })
    ).rejects.toMatchObject({ code: "stale_version" });
  } finally {
    await db.close();
  }
});

it("rejects a parent edit that disconnects a retained child boundary", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      fixture = await database.transaction(seedSpatialWorld);
    const intent = riverEdit(fixture);
    intent.scope = { ...intent.scope, areaId: fixture.root.id, footprint: fixture.root.footprint };
    intent.data = {
      areaId: fixture.root.id,
      feature: {
        id: fixture.feature.id,
        name: "Disconnected river",
        kind: "river",
        layerId: "rivers",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 10],
            [100, 10],
          ],
        },
        attributes: { elevations: [100, 0], discharges: [10, 10] },
        relations: [],
      },
    } satisfies ParameterValues;
    await expect(
      new IntentService(database, createIntentRegistry()).commit(fixture.world.id, "alice", intent)
    ).rejects.toMatchObject({ code: "locked_boundary" });
  } finally {
    await db.close();
  }
});
