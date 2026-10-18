import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createIntentRegistry, valueRecordSchema, type Intent } from "@atlas/domain";
import { testDatabase } from "./testDatabase";
import { Database } from "./dal/database";
import { seedSpatialWorld } from "./dal/spatialFixtures";
import { readAreas } from "./dal/areaReader";
import { readFeatures } from "./dal/objectReaders";
import { IntentService } from "./intentService";
import { UndoRepository } from "./dal/undo";

it("reconciles an owning feature's child interfaces while retaining authored detail and supports coherent undo", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      { world, root, child, feature, detail } = await database.transaction(seedSpatialWorld);
    const service = new IntentService(database, createIntentRegistry());
    const scope = {
      worldId: world.id,
      areaId: root.id,
      spaceId: world.id,
      footprint: root.footprint,
      crsId: world.reference.id,
      revision: 1,
      time: "present",
      resolution: null,
    };
    const intent: Intent = {
      operationId: randomUUID(),
      expectedVersion: 1,
      version: 1,
      kind: "reconcileFeature",
      scope,
      confirmed: true,
      data: valueRecordSchema.parse({
        areaId: root.id,
        feature: {
          id: feature.id,
          name: feature.name,
          kind: feature.kind,
          layerId: feature.layerId,
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 60],
              [100, 60],
            ],
          },
          attributes: feature.attributes,
          relations: feature.relations,
        },
      }),
    };
    const preview = await service.preview(world.id, "alice", intent);
    expect(preview.impact.highImpact).toBe(true);
    await service.commit(world.id, "alice", intent);
    const areas = await readAreas(db.client, world.id, 2, [child.id]),
      stored = (await readFeatures(db.client, world.id, 2, [feature.id])).objects[feature.id];
    expect(areas.objects[child.id].boundary?.crossings.map((c) => c.point.y)).toEqual([60, 60]);
    expect(areas.objects[child.id].boundary?.samples).toEqual(child.boundary?.samples);
    expect(stored.detail[child.id].geometry).toEqual(detail.geometry);
    expect(stored.detail[child.id].needsReconciliation).toBe(true);
    const reads = {
      scope: { ...scope, revision: 2 },
      objects: [],
      spatialLayers: [],
      channels: [],
      parentHistory: [],
      dependencies: true,
    };
    await new UndoRepository(database).undo(
      world.id,
      "alice",
      randomUUID(),
      intent.operationId,
      reads,
      { confirmed: true }
    );
    const restored = (await readFeatures(db.client, world.id, 3, [feature.id])).objects[feature.id];
    expect(restored.geometry).toEqual(feature.geometry);
    expect(restored.detail[child.id].needsReconciliation).toBe(false);
  } finally {
    await db.close();
  }
});
