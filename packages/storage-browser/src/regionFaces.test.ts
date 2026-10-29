import sqliteInit from "@sqlite.org/sqlite-wasm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  rectangle,
  createWorldBlueprint,
  type AtlasFeature,
  type CatalogRecord,
  type DomainWrite,
  type RegionQuery,
  type WorldMetadata,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { GeometryKernel } from "./geometryKernel";
import { SpatialCatalog } from "./spatialCatalog";
import { RegionFaces, shapeMask } from "./regionFaces";

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
  const catalog = new SpatialCatalog(new sqlite.oo1.DB(":memory:"), kernel, 125);
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
  const faces = new RegionFaces(catalog.boundaryTiles),
    mask = shapeMask(kernel, available, 0.000001);
  const at = (x: number, y: number, cuts: Geometry[] = []) =>
    faces.at(scope, mask, cuts, { x, y, z: 0 }, 0.000001);
  const area = (geometry: Geometry | null) =>
    geometry ? kernel.measure(geometry, 0.000001).area : 0;
  return { kernel, catalog, put, putRecord, at, area, faces, mask };
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
describe("connected geographic faces", () => {
  it("follows river and cut boundaries across many computational tiles", async () => {
    const f = await fixture();
    await f.put("river", {
      type: "LineString",
      coordinates: [
        [400, -10],
        [400, 1010],
      ],
    });
    const cut: Geometry = {
      type: "LineString",
      coordinates: [
        [-10, 500],
        [1010, 500],
      ],
    };
    expect(f.area(f.at(200, 200, [cut]))).toBeCloseTo(200_000);
    expect(f.area(f.at(800, 800, [cut]))).toBeCloseTo(300_000);
    const shape = f.at(200, 200, [cut])!;
    expect(f.kernel.encode(shape, 0.000001).bounds).toEqual([0, 0, 400, 500]);
  });
  it("retains disconnected holes and selects the geography inside a nested ring", async () => {
    const f = await fixture();
    await f.put("island", rectangle([400, 400, 600, 600]));
    await f.put("inner", rectangle([480, 480, 520, 520]));
    expect(f.area(f.at(100, 500))).toBeCloseTo(960_000);
    expect(f.area(f.at(450, 500))).toBeCloseTo(38_400);
    expect(f.area(f.at(500, 500))).toBeCloseTo(1_600);
  });
  it("ignores dangling lines as enclosure and invalidates changed boundary tiles", async () => {
    const f = await fixture();
    await f.put("spur", {
      type: "LineString",
      coordinates: [
        [200, 200],
        [300, 300],
      ],
    });
    expect(f.area(f.at(100, 100))).toBeCloseTo(1_000_000);
    await f.put("spur", {
      type: "LineString",
      coordinates: [
        [400, -10],
        [400, 1010],
      ],
    });
    expect(f.area(f.at(100, 100))).toBeCloseTo(400_000);
  });
  it("joins the same geographic face across the cylindrical chart seam", async () => {
    const f = await fixture();
    await f.put("seam-land", {
      type: "MultiPolygon",
      coordinates: [
        (rectangle([0, 200, 200, 800]) as import("geojson").Polygon).coordinates,
        (rectangle([800, 200, 1000, 800]) as import("geojson").Polygon).coordinates,
      ],
    });
    const shape = f.faces.at(scope, f.mask, [], { x: 100, y: 400, z: 0 }, 1e-6, [0, 0, 1000, 1000]);
    expect(shape?.type).toBe("MultiPolygon");
    expect(f.area(shape)).toBeCloseTo(240_000);
  });
});
describe("scoped region operations", () => {
  it("snaps long cuts and returns faces on both sides across distant tiles", async () => {
    const f = await fixture();
    await f.put("river", {
      type: "LineString",
      coordinates: [
        [400, 0],
        [400, 1000],
      ],
    });
    const result = await f.catalog.drawRegion({
      query: regionQuery({ position: null }),
      tolerance: 15,
      geometry: {
        type: "LineString",
        coordinates: [
          [9, 500],
          [990, 500],
        ],
      },
    });
    expect(result.cuts[0]).toMatchObject({
      coordinates: [
        [0, 500],
        [1000, 500],
      ],
    });
    const areas = result.candidates
      .map((c) => Math.round(f.area(c.footprint)))
      .sort((a, b) => a - b);
    expect(areas).toEqual([200_000, 200_000, 300_000, 300_000]);
  });
  it("opens existing children and excludes siblings from new outlines", async () => {
    const f = await fixture();
    await f.putRecord({
      kind: "view",
      value: {
        id: "child",
        name: "Child",
        areaId: scope.areaId,
        layers: [],
        region: { parentId: null, footprint: rectangle([0, 0, 400, 1000]) },
      },
    });
    expect((await f.catalog.regionChoices(regionQuery())).childId).toBe("child");
    const outline = await f.catalog.drawRegion({
      query: regionQuery(),
      tolerance: 1,
      geometry: rectangle([0, 0, 800, 800]),
    });
    expect(f.area(outline.candidate?.footprint ?? null)).toBeCloseTo(320_000);
    const saved = await f.catalog.readRecords(scope, "view", ["child"]);
    expect(saved[0].data).toMatchObject({
      kind: "view",
      value: { name: "Child", region: { parentId: null } },
    });
    const view = saved[0].data;
    expect(view.kind === "view" && f.area(view.value.region!.footprint)).toBeCloseTo(400_000);
  });
});
describe("sibling regions", () => {
  it("clips picked faces by siblings and nodes cuts that end on a sibling edge", async () => {
    const f = await fixture();
    await f.putRecord({
      kind: "view",
      value: {
        id: "west",
        name: "West",
        areaId: scope.areaId,
        layers: [],
        region: { parentId: null, footprint: rectangle([0, 0, 400, 1000]) },
      },
    });
    const picked = await f.catalog.regionChoices(
      regionQuery({ position: { x: 800, y: 500, z: 0 } })
    );
    expect(picked.childId).toBeNull();
    expect(picked.candidates.map((c) => Math.round(f.area(c.footprint)))).toEqual([600_000]);
    const divided = await f.catalog.drawRegion({
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
    expect(
      divided.candidates.map((c) => Math.round(f.area(c.footprint))).sort((a, b) => a - b)
    ).toEqual([300_000, 300_000]);
  });
});
