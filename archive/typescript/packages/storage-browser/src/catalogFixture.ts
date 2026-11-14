import sqliteInit from "@sqlite.org/sqlite-wasm";
import { afterEach, beforeAll } from "vitest";
import {
  rectangle,
  createWorldBlueprint,
  type AtlasFeature,
  type CatalogRecord,
  type FeatureQuery,
  type WorldMetadata,
} from "@atlas/domain";
import { GeometryKernel } from "./geometryKernel";
import { SpatialCatalog } from "./spatialCatalog";
import { writeRecord } from "./catalogRecords";

let sqlite: Awaited<ReturnType<typeof sqliteInit>>;
const opened: SpatialCatalog[] = [];
beforeAll(async () => {
  sqlite = await sqliteInit();
});
afterEach(async () => {
  for (const catalog of opened.splice(0)) await catalog.close();
});
export const scope = {
  worldId: "10000000-0000-4000-8000-000000000002",
  spaceId: "surface",
  areaId: "root",
};
export const world: WorldMetadata = {
  id: scope.worldId,
  name: "Atlas",
  seed: 7,
  version: 1,
  owner: "creator",
  reference: {
    id: "metres",
    topology: "planar",
    units: "metre",
    axes: "east,north,up",
    verticalDatum: "Sea level",
    domain: rectangle([0, 0, 1000, 1000]),
    precision: 0.000001,
    version: 1,
  },
  layers: {},
  fields: [],
  magic: [],
  landmarks: [],
  views: [],
  generations: [],
  epochs: [],
};
export async function fixture(inspect?: (db: import("@sqlite.org/sqlite-wasm").Database) => void) {
  const db = new sqlite.oo1.DB(":memory:"),
    kernel = await GeometryKernel.create(1024),
    catalog = new SpatialCatalog(db, kernel);
  opened.push(catalog);
  await catalog.createWorld(world);
  const blueprint = createWorldBlueprint({
    id: world.id,
    name: world.name,
    rootName: world.name,
    seed: world.seed,
    reference: world.reference,
  });
  writeRecord(
    db,
    kernel,
    {
      scope,
      reference: { kind: "area", id: scope.areaId, revision: 0 },
      data: {
        kind: "area",
        value: { ...blueprint.root, id: scope.areaId, spaceId: scope.spaceId },
      },
    },
    1,
    1e-6
  );
  inspect?.(db);
  return catalog;
}
export function record(id: string, geometry = rectangle([10, 10, 100, 100])): CatalogRecord {
  const feature: AtlasFeature = {
    id,
    areaId: scope.areaId,
    name: id,
    kind: "forest",
    layerId: "ecology",
    geometry,
    detail: {},
    attributes: {},
    relations: [],
    state: "generated",
    actor: "generator",
    protected: false,
    generationId: null,
    causes: [],
  };
  return {
    scope,
    reference: { kind: "feature", id, revision: 0 },
    data: { kind: "feature", value: feature },
  };
}
export function write(catalog: SpatialCatalog, records: CatalogRecord[]) {
  return catalog.commit({
    operationId: crypto.randomUUID(),
    worldId: scope.worldId,
    expected: records.map((r) => r.reference),
    writes: records,
    removes: [],
    resources: [],
  });
}
export function query(patch: Partial<FeatureQuery> = {}): FeatureQuery {
  return {
    scope,
    extent: [0, 0, 1000, 1000],
    geometry: null,
    predicate: "intersects",
    layers: [],
    after: null,
    limit: 10,
    ...patch,
  };
}
