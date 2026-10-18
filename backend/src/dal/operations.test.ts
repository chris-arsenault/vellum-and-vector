import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { testDatabase } from "../testDatabase";
import { Database } from "./database";
import { seedSpatialWorld } from "./spatialFixtures";
import { existingOperation, writeOperation, OperationRepository } from "./operations";
import { writeWorldHeader } from "./worldHeader";

it("retains scoped operation inputs and stable replay identity with immutable history", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      { world, child, feature, revisions } = await database.transaction(seedSpatialWorld),
      id = randomUUID();
    await database.transaction(async (sql) => {
      await writeWorldHeader(sql, { ...world, version: 2 });
      await sql.query("UPDATE atlas_worlds SET version=2 WHERE id=$1", [world.id]);
      await writeOperation(sql, {
        record: {
          worldId: world.id,
          operationId: id,
          version: 2,
          beforeVersion: 1,
          actor: "user:alice",
          kind: "inspectAndRecord",
          requestHash: "request-hash",
          commandVersion: 1,
          impact: {
            features: [feature.id],
            areas: [child.id],
            layers: ["rivers"],
            invalidations: [],
            highImpact: false,
          },
        },
        parameters: numericalParameters(child.id),
        reads: [
          {
            role: "source",
            kind: "feature",
            id: feature.id,
            revisionId: revisions.get(feature.id)!,
            version: 1,
          },
        ],
        scopes: [{ role: "read", spaceId: world.id, footprint: child.footprint }],
        changes: [],
        worldSettingsChanged: false,
      });
    });
    const repository = new OperationRepository(database),
      result = await repository.inspect(world.id, "alice", id);
    expect(result.parameters).toEqual({ areaId: child.id, requestedFlow: 10 });
    const samples = await db.client.query(
      `SELECT count(*)::int AS count FROM atlas_operation_settings WHERE world_id=$1 AND operation_id=$2`,
      [world.id, id]
    );
    expect(samples.rows[0].count).toBe(2);
    expect(result.reads[0].revisionId).toBe(revisions.get(feature.id));
    expect((await existingOperation(db.client, world.id, id, "request-hash"))?.version).toBe(2);
    await expect(existingOperation(db.client, world.id, id, "different")).rejects.toThrow(
      "different inputs"
    );
    await expect(repository.inspect(world.id, "bob", id)).rejects.toThrow("not found");
    await expect(
      db.client.query(
        "UPDATE atlas_operations SET actor='forged' WHERE world_id=$1 AND operation_id=$2",
        [world.id, id]
      )
    ).rejects.toThrow("immutable");
    expect((await repository.history(world.id, "alice", { offset: 0, limit: 1 })).total).toBe(1);
  } finally {
    await db.close();
  }
});

function numericalParameters(areaId: string) {
  return {
    areaId,
    requestedFlow: 10,
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
    channels: { elevation: { unit: "metre", values: Array.from({ length: 36864 }, (_, i) => i) } },
  };
}
