import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { valueRecordSchema, type Intent, type SpatialScope } from "@atlas/domain";
import { readNodes } from "./dal/networkRows";
import { testDatabase } from "./testDatabase";
import { Database } from "./dal/database";
import { createTestWorld } from "./testWorld";
import { queryNetworkPage } from "./dal/networkPages";

function edit(scope: SpatialScope, kind: string, data: unknown): Intent {
  return {
    operationId: randomUUID(),
    expectedVersion: scope.revision,
    version: 1,
    scope,
    kind,
    data: valueRecordSchema.parse(data),
  };
}
function road(
  id: string,
  coordinates: number[][],
  relations: { kind: string; targetId: string }[] = []
) {
  return {
    id,
    name: "Road",
    kind: "road",
    layerId: "roads",
    geometry: { type: "LineString", coordinates },
    attributes: { elevations: coordinates.map(() => 0) },
    relations,
    protected: false,
  };
}
async function moveJunction(
  fixture: Awaited<ReturnType<typeof createTestWorld>>,
  a: string,
  b: string,
  node: string
) {
  const { scope, world, service } = fixture;
  const move = edit({ ...scope, revision: 3 }, "moveNetworkNode", {
    nodeId: node,
    position: { x: 55, y: 55, z: 0 },
    edits: [
      {
        areaId: scope.areaId,
        feature: road(
          a,
          [
            [10, 50],
            [30, 40],
            [55, 55],
            [90, 50],
          ],
          [{ kind: "associatedWith", targetId: b }]
        ),
      },
      {
        areaId: scope.areaId,
        feature: road(
          b,
          [
            [50, 10],
            [55, 55],
            [50, 90],
          ],
          [{ kind: "associatedWith", targetId: a }]
        ),
      },
    ],
  });
  await expect(service.commit(world.id, "alice", move)).rejects.toMatchObject({
    code: "confirmation_required",
  });
  await service.commit(world.id, "alice", { ...move, confirmed: true });
}
it("nodes an atomic network edit, preserves incident identities and rejects disconnecting an anchored junction", async () => {
  const db = await testDatabase();
  try {
    const database = new Database(db.client),
      fixture = await createTestWorld(database),
      { world, scope, service } = fixture,
      a = randomUUID(),
      b = randomUUID();
    const features = [
      road(
        a,
        [
          [10, 50],
          [90, 50],
        ],
        [{ kind: "associatedWith", targetId: b }]
      ),
      road(
        b,
        [
          [50, 10],
          [50, 90],
        ],
        [{ kind: "associatedWith", targetId: a }]
      ),
    ];
    await service.commit(
      world.id,
      "alice",
      edit(scope, "putFeatures", { areaId: scope.areaId, features })
    );
    const current = { ...scope, revision: 2 };
    const page = await queryNetworkPage(db.client, current, "reach", { offset: 0, limit: 20 });
    expect(page.total).toBe(4);
    const before = await reachVersions(db.client, world.id, b);
    const first = edit(current, "putFeature", {
      areaId: scope.areaId,
      feature: road(
        a,
        [
          [10, 50],
          [30, 40],
          [50, 50],
          [90, 50],
        ],
        features[0].relations
      ),
    });
    await service.commit(world.id, "alice", first);
    const after = await reachVersions(db.client, world.id, b);
    expect(after.rows).toEqual(before.rows);
    const invalid = edit({ ...scope, revision: 3 }, "putFeature", {
      areaId: scope.areaId,
      feature: road(
        a,
        [
          [10, 40],
          [90, 40],
        ],
        features[0].relations
      ),
    });
    await expect(service.commit(world.id, "alice", invalid)).rejects.toMatchObject({
      code: "locked_junction",
    });
    await checkMovedJunction(db.client, fixture, a, b);
  } finally {
    await db.close();
  }
});
function reachVersions(sql: import("./dal/database").Sql, world: string, feature: string) {
  return sql.query(
    "SELECT id,revision_id FROM atlas_reaches WHERE scope_id=$1 AND feature_id=$2 AND valid_to IS NULL ORDER BY id",
    [world, feature]
  );
}
async function checkMovedJunction(
  sql: import("./dal/database").Sql,
  fixture: Awaited<ReturnType<typeof createTestWorld>>,
  a: string,
  b: string
) {
  const { scope, world } = fixture;
  const nodes = await queryNetworkPage(sql, { ...scope, revision: 3 }, "node", {
    offset: 0,
    limit: 20,
  });
  const junction = nodes.items.find(
    (n) => "position" in n && n.position.x === 50 && n.position.y === 50
  )!;
  await moveJunction(fixture, a, b, junction.id);
  const moved = (await readNodes(sql, world.id, 4, [junction.id])).objects[junction.id];
  expect(moved.position).toEqual({ x: 55, y: 55, z: 0 });
}
