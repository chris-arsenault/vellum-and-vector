import sqliteInit from "@sqlite.org/sqlite-wasm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createWorldBlueprint,
  rectangle,
  type CatalogRecord,
  type WorldMetadata,
  type AtlasFeature,
  type NumericalResource,
  type FieldGeography,
} from "@atlas/domain";
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
function blueprintFixture() {
  const blueprint = createWorldBlueprint({
    id: crypto.randomUUID(),
    name: "History",
    rootName: "World",
    seed: 7,
    reference: {
      id: "metres",
      topology: "planar",
      units: "metre",
      axes: "east,north,up",
      verticalDatum: "Sea level",
      version: 1,
      precision: 1e-6,
      domain: rectangle([0, 0, 1000, 1000]),
    },
  });
  return blueprint;
}
function woodland(areaId: string): AtlasFeature {
  return {
    id: "wood",
    areaId,
    name: "Woodland",
    kind: "forest",
    layerId: "ecology",
    geometry: rectangle([100, 100, 400, 400]),
    detail: {},
    attributes: {},
    relations: [],
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: null,
    causes: [],
  };
}
async function fixture() {
  const blueprint = blueprintFixture();
  const world: WorldMetadata = {
    id: blueprint.id,
    name: blueprint.name,
    seed: blueprint.seed,
    reference: blueprint.reference,
    version: 1,
    owner: "creator",
    layers: {},
    fields: [],
    magic: [],
    landmarks: [],
    views: [],
    generations: [],
    epochs: [],
  };
  const db = new sqlite.oo1.DB(":memory:"),
    catalog = new SpatialCatalog(db, await GeometryKernel.create());
  opened.push(catalog);
  await catalog.createWorld(world);
  const scope = { worldId: world.id, areaId: blueprint.root.id, spaceId: world.id };
  const feature = woodland(scope.areaId);
  const writes: CatalogRecord[] = [
    {
      scope,
      reference: { kind: "area", id: scope.areaId, revision: 0 },
      data: { kind: "area", value: blueprint.root },
    },
    {
      scope,
      reference: { kind: "feature", id: feature.id, revision: 0 },
      data: { kind: "feature", value: feature },
    },
  ];
  await catalog.commit({
    worldId: world.id,
    operationId: "seed",
    expected: writes.map((r) => r.reference),
    writes,
    removes: [],
    resources: [],
  });
  const edit = async (
    operationId: string,
    patch: Partial<AtlasFeature>,
    metadata?: { name: string }
  ) => {
    const record = (await catalog.readRecords(scope, "feature", [feature.id]))[0];
    if (record.data.kind !== "feature") throw new Error("Missing feature fixture.");
    record.data.value = { ...record.data.value, ...patch };
    return catalog.commit({
      worldId: world.id,
      operationId,
      expected: [record.reference],
      writes: [record],
      removes: [],
      resources: [],
      metadata,
    });
  };
  return { db, catalog, world, scope, edit };
}
function layoutResource(f: Awaited<ReturnType<typeof fixture>>): NumericalResource {
  return {
    schemaVersion: 1,
    id: "layout",
    revision: 1,
    scope: f.scope,
    crsId: f.world.reference.id,
    bounds: [0, 0, 1000, 1000],
    precision: 1e-6,
    layout: "regular",
    state: "ready",
    arrays: [],
    partitions: [],
  };
}
describe("immutable field geography", () => {
  it("publishes indexed geometry with its resources, retains water data and rolls back failed publication", async () => {
    const f = await fixture();
    const resource = layoutResource(f);
    const ocean = {
      type: "MultiPolygon" as const,
      coordinates: [
        (rectangle([0, 0, 100, 200]) as import("geojson").Polygon).coordinates,
        (rectangle([300, 300, 500, 500]) as import("geojson").Polygon).coordinates,
      ],
    };
    const geography: FieldGeography = {
      id: "layout",
      scope: f.scope,
      ocean,
      waterBodies: [
        {
          id: "lake",
          footprint: rectangle([600, 600, 700, 700]),
          slices: [
            { floor: 10, area: 100, footprint: rectangle([610, 610, 620, 620]), sediment: 2 },
            { floor: 9, area: 0, footprint: null, sediment: 0 },
          ],
          volume: 1000,
          spill: 12,
          outlet: { x: 700, y: 650, z: 12 },
          outletFrom: null,
          suspended: 3,
          fixedLevel: null,
          outletPath: null,
        },
      ],
    };
    const input = {
      operationId: "physical",
      worldId: f.world.id,
      expected: [],
      writes: [],
      removes: [],
      resources: [resource],
      geography: [geography],
      history: { kind: "generate", actor: "generator" },
    };
    await expect(f.catalog.commit({ ...input, resources: [] })).rejects.toThrow(/layout/);
    await f.catalog.commit(input);
    const restored = await f.catalog.readFieldGeography(f.scope, "layout");
    expect(restored.ocean?.type).toBe("MultiPolygon");
    expect(restored.waterBodies![0].volume).toBe(1000);
    expect(restored.waterBodies![0].slices[1].footprint).toBeNull();
    expect(restored.waterBodies![0].outlet).toEqual({ x: 700, y: 650, z: 12 });
    expect(f.db.selectValue("SELECT count(*) FROM field_geometry_parts")).toBe(4);
    expect(f.db.selectValue("SELECT count(*) FROM field_geometry_bounds WHERE max_x<200")).toBe(1);
    expect(String(f.db.selectValue("SELECT data FROM field_geography"))).not.toContain(
      "coordinates"
    );
    await expect(
      f.catalog.readFieldGeography({ ...f.scope, spaceId: "elsewhere" }, "layout")
    ).rejects.toThrow(/located/);
    const version = (await f.catalog.readWorld(f.world.id)).version;
    await expect(f.catalog.commit({ ...input, operationId: "replace" })).rejects.toThrow(
      /immutable/
    );
    expect((await f.catalog.readWorld(f.world.id)).version).toBe(version);
  });
});
describe("record history and undo", () => {
  it("shares immutable geometry across renames and restores records and metadata in undo order", async () => {
    const f = await fixture();
    const count = Number(f.db.selectValue("SELECT count(*) FROM geometry_values"));
    await f.edit("rename", { name: "Old Wood" }, { name: "Renamed world" });
    expect(Number(f.db.selectValue("SELECT count(*) FROM geometry_values"))).toBe(count);
    expect(
      f.db.selectValue(
        `SELECT h.geometry_id=r.geometry_id FROM operation_records h JOIN records_core r ON r.world_id=h.world_id AND r.kind=h.kind AND r.id=h.id WHERE h.operation_id='rename' AND h.kind='feature'`
      )
    ).toBe(1);
    await f.edit("move", { geometry: rectangle([600, 600, 900, 900]) });
    await expect(f.catalog.undo(f.world.id, "rename")).rejects.toThrow(/most recent/);
    await f.catalog.undo(f.world.id, "move");
    const restored = await f.catalog.readFeatures({
      scope: f.scope,
      extent: [100, 100, 400, 400],
      geometry: null,
      predicate: "intersects",
      layers: [],
      after: null,
      limit: 10,
    });
    expect(restored.records[0].feature.name).toBe("Old Wood");
    await f.catalog.undo(f.world.id, "rename");
    expect((await f.catalog.readWorld(f.world.id)).name).toBe("History");
    expect((await f.catalog.readRecords(f.scope, "feature", ["wood"]))[0].data.value).toMatchObject(
      { name: "Woodland" }
    );
    expect((await f.catalog.readHistory(f.world.id, null, 10)).map((h) => h.operationId)).toEqual([
      "seed",
    ]);
  });
});
describe("history transactions", () => {
  it("keeps the first before-image across progressive batches of one operation", async () => {
    const f = await fixture();
    await f.edit("generate", { geometry: rectangle([500, 500, 900, 900]) });
    await f.edit("generate", { name: "Generated woodland" });
    const page = await f.catalog.readHistory(f.world.id, null, 1);
    expect(page[0].operationId).toBe("generate");
    expect((await f.catalog.readHistory(f.world.id, page[0].version, 1))[0].operationId).toBe(
      "seed"
    );
    await f.catalog.undo(f.world.id, "generate");
    expect((await f.catalog.readRecords(f.scope, "feature", ["wood"]))[0].data.value).toMatchObject(
      { name: "Woodland" }
    );
    const found = await f.catalog.readFeatures({
      scope: f.scope,
      extent: [150, 150, 150, 150],
      geometry: { type: "Point", coordinates: [150, 150] },
      predicate: "covers",
      layers: [],
      after: null,
      limit: 10,
    });
    expect(found.records.map((r) => r.feature.id)).toEqual(["wood"]);
  });
  it("rolls back history, geometry and metadata together when a write is invalid", async () => {
    const f = await fixture();
    await expect(
      f.edit(
        "invalid",
        {
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [10, 10],
                [10, 0],
                [0, 10],
                [0, 0],
              ],
            ],
          },
        },
        { name: "Wrong" }
      )
    ).rejects.toThrow(/valid/);
    expect((await f.catalog.readWorld(f.world.id)).name).toBe("History");
    expect((await f.catalog.readHistory(f.world.id, null, 10)).map((h) => h.operationId)).toEqual([
      "seed",
    ]);
  });
});
function subjectRecords(f: Awaited<ReturnType<typeof fixture>>) {
  const landmarkId = "landmark-1";
  const realized: AtlasFeature = {
    ...woodland(f.scope.areaId),
    id: landmarkId,
    name: "Generated mountain",
    kind: "landmark",
    layerId: "geology",
    geometry: { type: "Point", coordinates: [500, 500] },
    footprint: rectangle([300, 300, 700, 700]),
    attributes: { causeId: `landmark:${landmarkId}`, signature: "realized" },
  };
  const writes: CatalogRecord[] = [
    {
      scope: f.scope,
      reference: { kind: "feature", id: landmarkId, revision: 0 },
      data: { kind: "feature", value: realized },
    },
    {
      scope: f.scope,
      reference: { kind: "landmark", id: landmarkId, revision: 0 },
      data: {
        kind: "landmark",
        value: {
          id: landmarkId,
          name: "Kibo",
          kind: "volcanic-mountain",
          geometry: { type: "Point", coordinates: [500, 500] },
          parameters: { summit: 5900, prominence: 4000, baseRadius: 5 },
          emplacedAtEpoch: 0,
          areaId: f.scope.areaId,
        },
      },
    },
    {
      scope: f.scope,
      reference: { kind: "magic", id: "fire", revision: 0 },
      data: {
        kind: "magic",
        value: {
          id: "fire",
          name: "Fire core",
          source: { x: 800, y: 800, z: 0 },
          areaId: f.scope.areaId,
          radius: 100,
          strength: 1,
          propagation: "radial",
          effect: "heat",
          decay: 0,
          storage: 0,
          dependsOn: null,
          startsAtEpoch: 0,
        },
      },
    },
  ];
  return writes;
}
describe("world-owned presentation subjects", () => {
  it("shows one landmark realization under its authored identity and keeps magic sources selectable", async () => {
    const f = await fixture(),
      landmarkId = "landmark-1",
      writes = subjectRecords(f);
    await f.catalog.commit({
      worldId: f.world.id,
      operationId: "sources",
      expected: writes.map((r) => r.reference),
      writes,
      removes: [],
      resources: [],
    });
    const page = await f.catalog.readFeatures({
      scope: f.scope,
      extent: [0, 0, 1000, 1000],
      geometry: null,
      predicate: "intersects",
      layers: ["geology", "magic"],
      after: null,
      limit: 10,
    });
    expect(page.records.map((r) => [r.feature.id, r.feature.name])).toEqual([
      ["fire", "Fire core"],
      [landmarkId, "Kibo"],
    ]);
    expect(page.records[1].feature.attributes.signature).toBe("realized");
    expect(
      f.db.selectValue("SELECT kind FROM identities WHERE world_id=? AND id=?", [
        f.world.id,
        landmarkId,
      ])
    ).toBe("landmark");
  });
});
