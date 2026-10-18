import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type {
  NetworkNode,
  NetworkReach,
  ReadRequirements,
  Area,
  AtlasFeature,
} from "@atlas/domain";
import { testDatabase } from "../testDatabase";
import { Database, registerObjects, type Sql } from "./database";
import { seedSpatialWorld } from "./spatialFixtures";
import { allocateRevisions } from "./revisions";
import { writeNodes, writeReaches } from "./networkRows";
import { writeArea } from "./areaWriter";
import { writeFeatureBases, writeConnections } from "./objectWriters";
import { queryNetworkPage } from "./networkPages";
import { readProjection } from "./projections";

async function networkFixture(sql: Sql) {
  const data = await seedSpatialWorld(sql),
    { world, root, child, feature } = data;
  const floor: Area = {
    ...child,
    id: randomUUID(),
    name: "Gallery",
    profile: "interior",
    spaceId: undefined,
    frame: { ...child.frame, floor: "upper", origin: { x: 20, y: 20, z: 10 } },
  };
  const following = {
    ...feature,
    id: randomUUID(),
    name: "Tributary",
    detail: {},
    protected: false,
    relations: [],
    geometry: {
      type: "LineString" as const,
      coordinates: [
        [80, 50],
        [95, 60],
      ],
    },
  };
  const entrance = {
    ...following,
    id: randomUUID(),
    areaId: floor.id,
    kind: "entrance",
    geometry: { type: "Point" as const, coordinates: [40, 50] },
  };
  const nodes = fixtureNodes(world.id, floor.id);
  const reaches = fixtureReaches(feature, following, nodes);
  const connection = {
    id: randomUUID(),
    kind: "stairs",
    a: { areaId: child.id, featureId: feature.id, position: { x: 40, y: 50, z: 0 } },
    b: { areaId: floor.id, featureId: entrance.id, position: nodes[3].position },
    flow: 0,
  };
  const objects = [
    { id: floor.id, kind: "area" },
    ...[following, entrance].map((f) => ({ id: f.id, kind: "feature" })),
    ...nodes.map((n) => ({ id: n.id, kind: "node" })),
    ...reaches.map((r) => ({ id: r.id, kind: "reach" })),
    { id: connection.id, kind: "connection" },
  ];
  await registerObjects(sql, world.id, objects);
  const revisions = await allocateRevisions(
    sql,
    world.id,
    objects.map((o) => o.id)
  );
  const revised = <T extends { id: string }>(values: T[]) =>
    values.map((value) => ({ value, revision: revisions.get(value.id)! }));
  await writeArea(sql, world.id, 1, revisions.get(floor.id)!, floor);
  await writeFeatureBases(sql, world.id, 1, revised([following, entrance]));
  await writeNodes(sql, world.id, 1, revised(nodes));
  await writeReaches(sql, world.id, 1, revised(reaches));
  await writeConnections(sql, world.id, 1, revised([connection]));
  return { ...data, floor, following, entrance, nodes, reaches, connection, root };
}
function fixtureNodes(world: string, floor: string): NetworkNode[] {
  return [
    {
      id: randomUUID(),
      kind: "source",
      spaceId: world,
      position: { x: 20, y: 50, z: 80 },
      waterLevel: null,
    },
    {
      id: randomUUID(),
      kind: "junction",
      spaceId: world,
      position: { x: 80, y: 50, z: 20 },
      waterLevel: null,
    },
    {
      id: randomUUID(),
      kind: "outlet",
      spaceId: world,
      position: { x: 95, y: 60, z: 5 },
      waterLevel: null,
    },
    {
      id: randomUUID(),
      kind: "access",
      spaceId: floor,
      position: { x: 40, y: 50, z: 10 },
      waterLevel: null,
    },
  ];
}
function fixtureReaches(
  feature: AtlasFeature,
  following: AtlasFeature,
  nodes: NetworkNode[]
): NetworkReach[] {
  return [
    {
      id: randomUUID(),
      featureId: feature.id,
      start: nodes[0].id,
      end: nodes[1].id,
      geometry: feature.geometry,
      flow: 10,
      endFlow: 10,
    },
    {
      id: randomUUID(),
      featureId: following.id,
      start: nodes[1].id,
      end: nodes[2].id,
      geometry: following.geometry,
      flow: 3,
      endFlow: 3,
    },
  ];
}
it("pages exact located network queries and loads the connected dependency scope", async () => {
  const db = await testDatabase();
  try {
    const data = await new Database(db.client).transaction(networkFixture);
    const input: ReadRequirements = {
      scope: {
        worldId: data.world.id,
        areaId: data.child.id,
        spaceId: data.world.id,
        footprint: data.child.footprint,
        crsId: data.world.reference.id,
        revision: 1,
        time: "present",
        resolution: null,
      },
      objects: [{ kind: "node", ids: [data.nodes[0].id] }],
      spatialLayers: [],
      channels: [],
      parentHistory: [],
      dependencies: true,
    };
    const first = await queryNetworkPage(db.client, input.scope, "node", { offset: 0, limit: 1 });
    expect(first.total).toBe(2);
    expect(first.items.length).toBe(1);
    expect(first.nextOffset).toBe(1);
    expect(
      (await queryNetworkPage(db.client, input.scope, "reach", { offset: 0, limit: 5 })).total
    ).toBe(2);
    expect(
      (
        await queryNetworkPage(db.client, { ...input.scope, spaceId: data.floor.id }, "node", {
          offset: 0,
          limit: 5,
        })
      ).total
    ).toBe(1);
    const projection = await readProjection(db.client, input);
    expect(Object.keys(projection.world.networkReaches!)).toHaveLength(2);
    expect(Object.keys(projection.world.features)).toEqual(
      expect.arrayContaining([data.feature.id, data.following.id, data.entrance.id])
    );
    expect(projection.world.connections![data.connection.id]).toEqual(data.connection);
    expect(projection.numerical).toEqual({});
  } finally {
    await db.close();
  }
});
