import sqliteInit from "@sqlite.org/sqlite-wasm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  rectangle,
  createWorldBlueprint,
  type AtlasFeature,
  type CatalogRecord,
  type DomainWrite,
  type RegionCandidate,
  type RegionQuery,
  type WorldMetadata,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { GeometryKernel } from "./geometryKernel";
import { SpatialCatalog } from "./spatialCatalog";

let sqlite: Awaited<ReturnType<typeof sqliteInit>>;
const opened: SpatialCatalog[] = [];
beforeAll(async () => {
  sqlite = await sqliteInit();
});
afterEach(async () => {
  for (const catalog of opened.splice(0)) await catalog.close();
});
const scope = {
  worldId: "10000000-0000-4000-8000-000000000001",
  spaceId: "surface",
  areaId: "root",
};
const available = rectangle([0, 0, 1000, 1000]);
function metadata(): WorldMetadata {
  return {
    id: scope.worldId,
    name: "Geography",
    seed: 7,
    version: 1,
    owner: "creator",
    reference: {
      id: "metres",
      topology: "planar",
      units: "metre",
      axes: "east,north,up",
      verticalDatum: "Sea level",
      precision: 0.000001,
      version: 1,
      domain: available,
    },
    layers: {},
    fields: [],
    magic: [],
    landmarks: [],
    views: [],
    generations: [],
    epochs: [],
  };
}
async function fixture() {
  const kernel = await GeometryKernel.create();
  const catalog = new SpatialCatalog(new sqlite.oo1.DB(":memory:"), kernel);
  opened.push(catalog);
  const world = metadata();
  await catalog.createWorld(world);
  const blueprint = createWorldBlueprint({
    id: world.id,
    name: world.name,
    rootName: world.name,
    seed: world.seed,
    reference: world.reference,
  });
  const revisions = new Map<string, number>();
  const putRecord = async (data: DomainWrite) => {
    const reference: CatalogRecord["reference"] = {
      kind: data.kind,
      id: data.value.id!,
      revision: revisions.get(data.value.id!) ?? 0,
    };
    const result = await catalog.commit({
      operationId: crypto.randomUUID(),
      worldId: scope.worldId,
      expected: [reference],
      writes: [{ scope, reference, data }],
      removes: [],
      resources: [],
    });
    revisions.set(reference.id, result.revision);
  };
  await putRecord({
    kind: "area",
    value: { ...blueprint.root, id: scope.areaId, spaceId: scope.spaceId },
  });
  const put = async (id: string, geometry: Geometry) => {
    const feature: AtlasFeature = {
      id,
      areaId: "root",
      layerId: "ecology",
      name: id,
      kind: "forest",
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
    await putRecord({ kind: "feature", value: feature });
  };
  const child = (id: string, footprint: Geometry) =>
    putRecord({
      kind: "view",
      value: {
        id,
        name: id,
        areaId: scope.areaId,
        layers: [],
        region: { parentId: null, footprint },
      },
    });
  const areas = (candidates: RegionCandidate[]) =>
    candidates
      .map((c) => Math.round(kernel.measure(c.footprint, 0.000001).area))
      .sort((a, b) => a - b);
  const pick = (x: number, y: number, cuts: Geometry[] = []) =>
    catalog.regionChoices(regionQuery({ position: { x, y, z: 0 }, cuts }));
  return { kernel, catalog, put, child, areas, pick };
}
function regionQuery(patch: Partial<RegionQuery> = {}): RegionQuery {
  return {
    scope,
    sourceAreaId: scope.areaId,
    parentId: null,
    editingId: null,
    cuts: [],
    position: { x: 200, y: 200, z: 0 },
    viewport: [0, 0, 1000, 1000],
    ...patch,
  };
}
const across: Geometry = {
  type: "LineString",
  coordinates: [
    [9, 500],
    [990, 500],
  ],
};
describe("region picks", () => {
  it("proposes the indexed polygons under a click and nothing elsewhere", async () => {
    const f = await fixture();
    await f.put("forest", rectangle([100, 100, 600, 600]));
    await f.put("grove", rectangle([200, 200, 400, 400]));
    const picked = await f.pick(300, 300);
    expect(picked.childId).toBeNull();
    expect(f.areas(picked.candidates)).toEqual([40_000, 250_000]);
    expect(f.areas((await f.pick(500, 500)).candidates)).toEqual([250_000]);
    expect((await f.pick(800, 800)).candidates).toEqual([]);
  });
  it("opens existing children and clips proposals by them", async () => {
    const f = await fixture();
    await f.put("forest", rectangle([100, 100, 600, 600]));
    await f.child("west", rectangle([0, 0, 400, 1000]));
    expect((await f.pick(200, 200)).childId).toBe("west");
    expect(f.areas((await f.pick(500, 300)).candidates)).toEqual([100_000]);
    const outline = await f.catalog.drawRegion({
      query: regionQuery(),
      tolerance: 1,
      geometry: rectangle([0, 0, 800, 800]),
    });
    expect(f.areas(outline.candidate ? [outline.candidate] : [])).toEqual([320_000]);
  });
});
describe("region lines", () => {
  it("snaps a line and splits the polygons it crosses", async () => {
    const f = await fixture();
    await f.put("forest", rectangle([100, 100, 600, 800]));
    const result = await f.catalog.drawRegion({
      query: regionQuery({ position: null }),
      tolerance: 15,
      geometry: across,
    });
    expect(result.cuts[0]).toMatchObject({
      coordinates: [
        [0, 500],
        [1000, 500],
      ],
    });
    expect(f.areas(result.candidates)).toEqual([150_000, 200_000]);
    expect(f.areas((await f.pick(300, 550, result.cuts)).candidates)).toEqual([150_000]);
    expect((await f.pick(800, 900, result.cuts)).candidates).toEqual([]);
  });
  it("splits a polygon beside a sibling at the sibling's edge", async () => {
    const f = await fixture();
    await f.put("plain", rectangle([0, 0, 1000, 1000]));
    await f.child("west", rectangle([0, 0, 400, 1000]));
    const result = await f.catalog.drawRegion({
      query: regionQuery({ position: null }),
      tolerance: 15,
      geometry: {
        type: "LineString",
        coordinates: [
          [410, 500],
          [990, 500],
        ],
      },
    });
    expect(f.areas(result.candidates)).toEqual([300_000, 300_000]);
  });
});
