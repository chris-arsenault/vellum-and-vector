import { randomUUID } from "node:crypto";
import {
  createWorldBlueprint,
  rectangle,
  createIntentRegistry,
  type SpatialScope,
} from "@atlas/domain";
import { WorldRepository } from "./dal/worlds";
import { IntentService } from "./intentService";
import type { Database } from "./dal/database";

export async function createTestWorld(database: Database) {
  const world = createWorldBlueprint({
    id: randomUUID(),
    name: "Atlas",
    seed: 42,
    reference: {
      id: "fictional",
      domain: rectangle([0, 0, 100, 100]),
      topology: "planar",
      units: "metre",
      axes: "east,north,up",
      verticalDatum: "sea",
      version: 1,
      precision: 1e-6,
    },
  });
  await new WorldRepository(database).create("alice", randomUUID(), world);
  const scope: SpatialScope = {
    worldId: world.id,
    areaId: world.root.id,
    spaceId: world.id,
    footprint: world.reference.domain,
    crsId: world.reference.id,
    revision: 1,
    time: "present",
    resolution: null,
  };
  return { world, scope, service: new IntentService(database, createIntentRegistry()) };
}
