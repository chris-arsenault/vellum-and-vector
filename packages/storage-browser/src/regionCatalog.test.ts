import sqliteInit from "@sqlite.org/sqlite-wasm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  rectangle,
  createWorldBlueprint,
  spatial,
  regionalSelectionArea,
  regionalScale,
  type AtlasFeature,
  type CatalogRecord,
  type DomainWrite,
  type RegionCandidate,
  type RegionQuery,
  type NumericalResource,
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
function metadata(domain = available, cylinder = false): WorldMetadata {
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
      domain,
      ...(cylinder ? { boundaryMode: "cylinder" as const } : {}),
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
async function fixture(domain = available, cylinder = false) {
  const kernel = await GeometryKernel.create();
  const catalog = new SpatialCatalog(new sqlite.oo1.DB(":memory:"), kernel);
  opened.push(catalog);
  const world = metadata(domain, cylinder);
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
  const put = async (id: string, geometry: Geometry, footprint?: Geometry) => {
    const feature: AtlasFeature = {
      id,
      areaId: "root",
      layerId: "ecology",
      name: id,
      kind: "forest",
      geometry,
      ...(footprint ? { footprint } : {}),
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
  return { kernel, catalog, put, child, areas, pick, putRecord, domain };
}
async function coastline(f: Awaited<ReturnType<typeof fixture>>, island: Geometry) {
  const resource: NumericalResource = {
    schemaVersion: 1,
    id: "terrain",
    revision: 1,
    scope,
    crsId: "metres",
    bounds: f.kernel.encode(f.domain, 1e-6).bounds,
    precision: 1e-6,
    layout: "regular",
    state: "ready",
    arrays: [],
    partitions: [],
    field: {
      id: "terrain",
      scope: {
        ...scope,
        crsId: "metres",
        footprint: f.domain,
        revision: 1,
        time: "present",
        resolution: 100,
      },
      layoutResourceId: "terrain",
      geographyId: "terrain",
      channels: {},
    },
  };
  await f.catalog.commit({
    operationId: crypto.randomUUID(),
    worldId: scope.worldId,
    expected: [],
    writes: [],
    removes: [],
    resources: [resource],
    geography: [
      { id: "terrain", scope, ocean: f.kernel.overlay(f.domain, island, 1e-6, "difference") },
    ],
  });
  await f.putRecord({
    kind: "field",
    value: {
      id: "terrain",
      areaId: "root",
      layerId: "elevation",
      samples: 0,
      algorithm: "fixture",
      source: { kind: "operation", id: "supplied" },
      channels: ["elevation"],
      resourceId: "terrain",
    },
  });
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

it("selects land when a covering feature also touches another island along an edge", async () => {
  const f = await fixture();
  await coastline(f, {
    type: "MultiPolygon",
    coordinates: [
      (rectangle([100, 100, 400, 400]) as import("geojson").Polygon).coordinates,
      (rectangle([600, 100, 900, 400]) as import("geojson").Polygon).coordinates,
    ],
  });
  await f.put("touching-claim", rectangle([200, 150, 600, 350]));
  const choices = await f.pick(250, 250);
  expect(f.areas(choices.candidates)).toEqual([40000, 90000]);
  expect(choices.candidates.every((c) => c.footprint.type === "Polygon")).toBe(true);
});
it("selects one continuous region across the cylindrical seam from either side", async () => {
  const f = await fixture(available, true),
    land = spatial.union(rectangle([0, 100, 180, 700]), rectangle([820, 100, 1000, 700]));
  await coastline(f, land);
  await f.put("Seam country", land);
  for (const x of [50, 950]) {
    const picked = (await f.pick(x, 300)).candidates[0].footprint;
    expect(spatial.covers(picked, land)).toBe(true);
    expect(spatial.difference(picked, land)).toBeNull();
  }
});
const across: Geometry = {
  type: "LineString",
  coordinates: [
    [9, 500],
    [990, 500],
  ],
};
it("offers a region-sized piece within a large landmass instead of defaulting to a whole continent or tiny biome", async () => {
  const domain = rectangle([0, 0, 4_000_000, 3_000_000]),
    f = await fixture(domain);
  await coastline(f, rectangle([200_000, 200_000, 1_600_000, 2_800_000]));
  await f.put("Small grove", rectangle([600_000, 1_800_000, 620_000, 1_820_000]));
  const query = regionQuery({
    position: { x: 610_000, y: 1_810_000, z: 0 },
    viewport: [0, 0, 4_000_000, 3_000_000],
  });
  const first = (await f.catalog.regionChoices(query)).candidates;
  const target = regionalSelectionArea(1),
    area = spatial.area(first[0].footprint);
  expect(area).toBeGreaterThan(target / 4);
  expect(area).toBeLessThan(target * 2.5);
  const [w, s, e, n] = spatial.bounds(first[0].footprint);
  expect(((e - w) * (n - s)) / regionalScale(1).cellArea).toBeLessThan(180_000);
  expect(first.some((candidate) => candidate.name === "Landmass")).toBe(true);
  expect(first.some((candidate) => candidate.name === "Small grove")).toBe(true);
  const closer = await f.catalog.regionChoices({
    ...query,
    viewport: [500_000, 1_700_000, 700_000, 1_900_000],
  });
  expect(closer.candidates[0]).toEqual(first[0]);
  const nearbyQuery = { ...query, position: { x: 1_300_000, y: 500_000, z: 0 } };
  const nearby = (await f.catalog.regionChoices(nearbyQuery)).candidates[0];
  await f.child("kept-region", first[0].footprint);
  expect((await f.catalog.regionChoices(nearbyQuery)).candidates[0]).toEqual(nearby);
});
it("offers a whole island and clips named terrestrial regions to its physical coast", async () => {
  const f = await fixture(),
    island = {
      type: "Polygon" as const,
      coordinates: [
        [
          [150, 200],
          [750, 100],
          [850, 650],
          [350, 850],
          [150, 200],
        ],
      ],
    };
  await coastline(f, island);
  await f.put("hill country", rectangle([50, 50, 600, 950]));
  const picked = (await f.pick(400, 400)).candidates;
  const landmass = picked.find((candidate) => candidate.name === "Landmass")!;
  expect(f.kernel.overlay(landmass.footprint, island, 1e-6, "difference")).toBeNull();
  expect(f.kernel.measure(landmass.footprint, 1e-6).area).toBe(f.kernel.measure(island, 1e-6).area);
  expect(
    picked.every((candidate) => !f.kernel.overlay(candidate.footprint, island, 1e-6, "difference"))
  ).toBe(true);
  expect((await f.pick(950, 950)).candidates).toEqual([]);
  await f.child("east", rectangle([600, 0, 1000, 1000]));
  const remainder = (await f.pick(400, 400)).candidates,
    expected = f.kernel.overlay(island, rectangle([600, 0, 1000, 1000]), 1e-6, "difference")!;
  expect(
    remainder.some(
      (candidate) =>
        f.kernel.relation(candidate.footprint, expected, 1e-6, "covers") &&
        f.kernel.relation(expected, candidate.footprint, 1e-6, "covers")
    )
  ).toBe(true);
});
it("selects smaller districts using the open map's captured level without a live parent", async () => {
  const domain = rectangle([0, 0, 700_000, 500_000]),
    f = await fixture(domain),
    world = await f.catalog.readEditor(scope.worldId);
  await f.putRecord({
    kind: "area",
    value: {
      ...world.areas.root,
      map: { sourceAreaId: "captured-parent", sourceRevision: 1, refinementLevel: 1 },
    },
  });
  await f.put("Regional country", rectangle([10_000, 10_000, 690_000, 490_000]));
  const picked = await f.pick(300_000, 250_000),
    target = regionalSelectionArea(2);
  expect(spatial.area(picked.candidates[0].footprint)).toBeGreaterThan(target / 2);
  expect(spatial.area(picked.candidates[0].footprint)).toBeLessThan(target * 2);
  expect(picked.candidates.some((c) => c.name === "Regional country")).toBe(true);
});
describe("region picks", () => {
  it("uses published polygon boundaries and excludes point and course influence footprints", async () => {
    const f = await fixture();
    await f.put("forest", rectangle([100, 100, 600, 600]), rectangle([50, 50, 700, 700]));
    await f.put(
      "summit",
      { type: "Point", coordinates: [300, 300] },
      rectangle([200, 200, 400, 400])
    );
    await f.put("river", across, rectangle([100, 450, 800, 550]));
    expect(f.areas((await f.pick(300, 300)).candidates)).toEqual([250_000]);
    expect(f.areas((await f.pick(300, 500)).candidates)).toEqual([250_000]);
    expect((await f.pick(650, 650)).candidates).toEqual([]);
  });
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
