import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { spatial, type ReadRequirements } from "@atlas/domain";
import { testDatabase } from "../testDatabase";
import { Database } from "./database";
import { seedSpatialWorld } from "./spatialFixtures";
import { CommitRepository, type PreparedOperation } from "./commits";
import { UndoRepository } from "./undo";
import { querySpatialPage } from "./spatialRows";

type Fixture = Awaited<ReturnType<typeof seedSpatialWorld>>;
function requirements(data: Fixture, revision: number): ReadRequirements {
  return {
    scope: {
      worldId: data.world.id,
      areaId: data.child.id,
      spaceId: data.world.id,
      footprint: data.child.footprint,
      crsId: data.world.reference.id,
      revision,
      time: "present",
      resolution: null,
    },
    objects: [{ kind: "feature", ids: [data.feature.id] }],
    spatialLayers: [],
    channels: [],
    parentHistory: [],
    dependencies: true,
  };
}
function reshape(data: Fixture, revision: number, x: number): PreparedOperation {
  const id = randomUUID();
  return {
    id,
    version: 1,
    kind: "reshape",
    expectedVersion: revision,
    parameters: { x },
    reads: requirements(data, revision),
    evaluate(snapshot) {
      const feature = snapshot.world.features[data.feature.id],
        detail = feature.detail[data.child.id];
      return {
        operationId: id,
        actor: "user:alice",
        worldId: data.world.id,
        expectedVersion: revision,
        readSet: snapshot.revisions,
        writes: [
          {
            kind: "representation",
            value: {
              ...detail,
              id: data.detail.id,
              featureId: feature.id,
              areaId: data.child.id,
              geometry: {
                type: "LineString",
                coordinates: [
                  [20, 50],
                  [x, 40],
                  [80, 50],
                ],
              },
            },
          },
        ],
        removes: [],
        invalidations: [],
        highImpact: false,
      };
    },
  };
}
async function addFollowingBorder(repository: CommitRepository, data: Fixture) {
  const id = randomUUID(),
    border = {
      ...data.feature,
      id,
      name: "River border",
      kind: "border",
      protected: false,
      detail: {},
      relations: [{ targetId: data.feature.id, kind: "follows" }],
    };
  await repository.commit(data.world.id, "alice", {
    id: randomUUID(),
    version: 1,
    kind: "addFeature",
    expectedVersion: 1,
    parameters: { id },
    reads: requirements(data, 1),
    evaluate(snapshot) {
      return {
        operationId: this.id,
        actor: "user:alice",
        worldId: data.world.id,
        expectedVersion: 1,
        readSet: snapshot.revisions,
        writes: [{ kind: "feature", value: border }],
        removes: [],
        invalidations: [],
        highImpact: false,
      };
    },
  });
  return id;
}
it("publishes scoped revisions atomically, updates following geometry, and makes conflict-aware undo a new revision", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      data = await database.transaction(seedSpatialWorld),
      repository = new CommitRepository(database);
    const border = await addFollowingBorder(repository, data);
    const command = reshape(data, 2, 55),
      record = await repository.commit(data.world.id, "alice", command);
    expect(record.version).toBe(3);
    expect((await repository.commit(data.world.id, "alice", command)).version).toBe(3);
    const current = await querySpatialPage(db.client, requirements(data, 3).scope, [], {
      offset: 0,
      limit: 10,
    });
    const river = current.items.find((f) => f.featureId === data.feature.id)!,
      following = current.items.find((f) => f.featureId === border)!;
    expect(spatial.covers(river.geometry, { type: "Point", coordinates: [55, 40] })).toBe(true);
    expect(spatial.covers(following.geometry, { type: "Point", coordinates: [55, 40] })).toBe(true);
    const undo = new UndoRepository(database),
      operation = randomUUID();
    expect(
      (await undo.undo(data.world.id, "alice", operation, command.id, requirements(data, 3)))
        .version
    ).toBe(4);
    expect(
      (await undo.undo(data.world.id, "alice", operation, command.id, requirements(data, 3)))
        .version
    ).toBe(4);
    const restored = await querySpatialPage(db.client, requirements(data, 4).scope, [], {
      offset: 0,
      limit: 10,
    });
    expect(
      spatial.covers(restored.items.find((f) => f.featureId === data.feature.id)!.geometry, {
        type: "Point",
        coordinates: [35, 45],
      })
    ).toBe(true);
    await expect(
      undo.undo(data.world.id, "alice", randomUUID(), command.id, requirements(data, 4))
    ).rejects.toThrow("changed");
    const failed = reshape(data, 4, 60);
    failed.evaluate = () => {
      throw new Error("rejected candidate");
    };
    await expect(repository.commit(data.world.id, "alice", failed)).rejects.toThrow(
      "rejected candidate"
    );
    expect(
      (await db.client.query("SELECT version FROM atlas_worlds WHERE id=$1", [data.world.id]))
        .rows[0].version
    ).toBe("4");
  } finally {
    await db.close();
  }
});
