import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { initializeEngine } from "@atlas/engine";
import type { MapFeature, PublishedAsset } from "@atlas/map";
import { descriptor, rectangle, sample } from "../../storage-browser/src/mapPublicationFixture";
import { initializeMapSchema } from "./database";
import { grantMapReader } from "./permissions";
import { PostgresMapPublication } from "./mapPublication";
import { PostgresMapCatalog } from "./mapCatalog";
import { PostgresMapInteractions } from "./mapInteractions";
import { PostgresMapRegistry } from "./mapRegistry";
import { PostgresMapSettlements } from "./mapSettlements";
import { registryFixture, registryRequest } from "../../storage-browser/src/mapRegistryFixture";

let container: StartedPostgreSqlContainer, pool: Pool;
let publication: PostgresMapPublication, maps: PostgresMapCatalog;
beforeAll(async () => {
  await initializeEngine(
    await readFile(new URL("../../engine/dist/atlas_host_bg.wasm", import.meta.url))
  );
  container = await new PostgreSqlContainer("postgis/postgis:16-3.5").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await initializeMapSchema(pool);
  publication = new PostgresMapPublication(pool);
  maps = new PostgresMapCatalog(pool);
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
beforeEach(async () => {
  await pool.query("TRUNCATE map.revisions CASCADE");
});
function assets(): PublishedAsset[] {
  return ["places", "height"].map((id) => ({
    id,
    mediaType: id === "height" ? "image/tiff" : "application/geo+json",
    location: `maps/${id}`,
    byteLength: 100,
    illustration: false,
  }));
}
function feature(id: string, geometry: MapFeature["geometry"] = rectangle): MapFeature {
  return {
    id,
    geometry,
    name: id,
    spaceId: "surface",
    layerId: "places",
    typeId: "place",
    kind: "place",
    entityId: null,
    footprint: null,
    attributes: {},
    relations: [],
    causes: [],
    catalog: { values: {}, columns: [], origin: "Generated geography", mapOnly: false },
  };
}
async function complete(revision: string) {
  const map = descriptor(revision);
  await publication.begin(map, null, true);
  await publication.append(map.reference, { assets: assets(), samples: [sample] });
  await publication.finish(map.reference);
  return map.reference;
}

it("reads map geography, sample values, entities and history through scoped PostGIS queries", async () => {
  const ref = await complete("one");
  expect((await maps.open(ref)).state).toBe("complete");
  expect((await maps.samplesAt(ref, "surface", [5, 5]))[0]).toMatchObject({
    center: [5, 5],
    measure: 100,
    attributes: [{ value: 25, label: "Height" }],
  });
  expect(await maps.samplesAt(ref, "surface", [11, 5])).toEqual([]);
  const next = descriptor("two");
  await publication.begin(next, ref, false);
  await publication.append(next.reference, {
    assets: assets(),
    features: [feature("peak", { type: "Point", coordinates: [5, 5] })],
    entities: [{ id: "realm", name: "Coastal union", kind: "polity", people: 1200, places: 3 }],
    history: [
      {
        id: "uplift",
        title: "Uplift",
        description: "Raised ground",
        epoch: 2,
        featureIds: ["peak"],
        attributes: {},
      },
    ],
  });
  await publication.finish(next.reference);
  expect(
    (await maps.features(next.reference, { spaceId: "surface", bounds: [4, 4, 6, 6] })).items[0].id
  ).toBe("peak");
  expect((await maps.history(next.reference, "", ["peak"])).items[0].id).toBe("uplift");
  expect((await maps.history(next.reference, "", ["absent"])).items).toEqual([]);
  expect((await maps.entities(next.reference, ["realm"]))[0].name).toBe("Coastal union");
  expect((await maps.features(ref, { spaceId: "surface" })).items).toEqual([]);
});

it("publishes replacement heads atomically and rejects concurrent stale publication", async () => {
  const old = await complete("old"),
    left = descriptor("left"),
    right = descriptor("right");
  await publication.begin(left, old, false);
  await publication.begin(right, old, false);
  await publication.append(left.reference, { assets: assets() });
  await publication.append(right.reference, { assets: assets() });
  expect(await maps.findHead(old.mapId)).toEqual(old);
  const results = await Promise.allSettled([
    publication.finish(left.reference),
    publication.finish(right.reference),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect((await maps.open(old)).state).toBe("complete");
  await expect(publication.append(old, { samples: [sample] })).rejects.toThrow("not open");
});

it("retains incomplete initial delivery but discards an unpublished replacement", async () => {
  const map = descriptor("initial");
  await publication.begin(map, null, true);
  await publication.append(map.reference, { samples: [sample] });
  await expect(publication.finish(map.reference)).rejects.toThrow("missing published asset");
  await publication.discard(map.reference);
  expect((await maps.open(map.reference)).state).toBe("incomplete");
  expect(await maps.samplesAt(map.reference, "surface", [5, 5])).toHaveLength(1);
  const next = descriptor("discarded");
  await publication.begin(next, map.reference, false);
  await publication.discard(next.reference);
  await expect(maps.open(next.reference)).rejects.toThrow("not found");
});

it("filters real geometry before pagination and does not return polygons through their holes", async () => {
  const map = descriptor("spatial");
  await publication.begin(map, null, true);
  const hollow: MapFeature["geometry"] = {
    type: "Polygon",
    coordinates: [
      rectangle.coordinates[0],
      [
        [4, 4],
        [4, 6],
        [6, 6],
        [6, 4],
        [4, 4],
      ],
    ],
  };
  await publication.append(map.reference, {
    features: [
      ...Array.from({ length: 257 }, (_, i) => feature(String(i).padStart(3, "0"), hollow)),
      feature("last"),
    ],
  });
  const selected = await maps.features(map.reference, {
    spaceId: "surface",
    geometry: { type: "Point", coordinates: [5, 5] },
  });
  expect(selected.items.map((item) => item.id)).toEqual(["last"]);
  const first = await maps.features(map.reference, { spaceId: "surface" });
  expect(first.items).toHaveLength(256);
  const second = await maps.features(map.reference, { spaceId: "surface", cursor: first.next! });
  expect(second.items.map((item) => item.id)).toEqual(["256", "last"]);
});

it("gives a map reader no access to private inputs or map writes", async () => {
  await complete("one");
  await pool.query("CREATE TABLE generation.private_inputs(id text)");
  await pool.query("CREATE ROLE atlas_fixture_reader");
  await grantMapReader(pool, "atlas_fixture_reader");
  const client = await pool.connect();
  try {
    await client.query("SET ROLE atlas_fixture_reader");
    expect((await new PostgresMapCatalog(client).findHead("island"))?.revision).toBe("one");
    await expect(client.query("SELECT * FROM generation.private_inputs")).rejects.toThrow(
      "permission denied"
    );
    await expect(client.query("DELETE FROM map.heads")).rejects.toThrow("permission denied");
  } finally {
    await client.query("RESET ROLE");
    client.release();
  }
});

it("inspects nearby places and lines, containing polygons, and pinned whole-region selections", async () => {
  const map = descriptor("picking");
  map.spaces[0].periodicWidth = 10;
  await publication.begin(map, null, true);
  await publication.append(map.reference, {
    samples: [sample],
    features: [
      feature("island"),
      feature("adjacent", {
        type: "Polygon",
        coordinates: [
          [
            [6, 6],
            [9, 6],
            [9, 9],
            [6, 9],
            [6, 6],
          ],
        ],
      }),
      feature("place", { type: "Point", coordinates: [6, 6] }),
      feature("line", {
        type: "LineString",
        coordinates: [
          [6, 0],
          [6, 10],
        ],
      }),
    ],
    history: [
      {
        id: "formed",
        title: "Island",
        description: "Raised",
        epoch: 1,
        featureIds: ["island"],
        attributes: {},
      },
    ],
  });
  const interactions = new PostgresMapInteractions(maps, pool);
  const inspected = await interactions.inspect(map.reference, {
    spaceId: "surface",
    position: [15, 5],
    tolerance: 2,
  });
  expect(inspected.position).toEqual([5, 5]);
  expect(inspected.features.map((f) => f.id)).toEqual(["place", "line", "island"]);
  expect(inspected.samples[0]).toMatchObject({ value: 25, cellSpan: 10, unit: "metre" });
  expect(inspected.causes.map((entry) => entry.id)).toEqual(["formed"]);
  const selected = await interactions.selectRegion(map.reference, {
    spaceId: "surface",
    featureIds: ["island"],
  });
  expect(selected.parent).toEqual(map.reference);
  expect(selected.featureIds).toEqual(["island"]);
  const { rows } = await pool.query("SELECT ST_Area(ST_GeomFromGeoJSON($1)) AS area", [
    JSON.stringify(selected.geometry),
  ]);
  expect(rows[0].area).toBe(100);
  await expect(
    interactions.selectRegion(map.reference, { spaceId: "surface", featureIds: ["absent"] })
  ).rejects.toThrow("absent");
});

it("rejects invalid geometry and rolls back the whole publication batch", async () => {
  const map = descriptor("invalid");
  await publication.begin(map, null, true);
  await expect(
    publication.append(map.reference, {
      features: [
        feature("valid"),
        feature("bowtie", {
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
        }),
      ],
    })
  ).rejects.toThrow("Geometry must be valid");
  expect((await maps.features(map.reference, { spaceId: "surface" })).items).toEqual([]);
});

it("filters and sorts the same registry records and resolves settlement relations on the map", async () => {
  const { map, features } = registryFixture();
  await publication.begin(map, null, true);
  await publication.append(map.reference, { features });
  const registry = new PostgresMapRegistry(pool, maps),
    request = registryRequest();
  const result = await registry.read(map.reference, request);
  expect(result.total).toBe(5);
  expect(result.matching).toBe(2);
  expect(result.rows.map((row) => row.feature.id)).toEqual(["town", "neighbour"]);
  expect(result.columns).toContainEqual({ key: "population", label: "Residents", numeric: true });
  expect(result.facets.categories.status).toEqual(["inhabited"]);
  request.query.attributes = [{ key: "population", min: "15", max: "", text: "" }];
  expect((await registry.read(map.reference, request)).rows.map((row) => row.feature.id)).toEqual([
    "town",
  ]);
  request.query.attributes = [];
  request.query.protectedOnly = true;
  expect((await registry.read(map.reference, request)).matching).toBe(1);
  request.bounds = [20, 20, 30, 30];
  expect((await registry.read(map.reference, request)).total).toBe(0);
  const settlements = new PostgresMapSettlements(pool, maps);
  expect(
    (await settlements.read(map.reference, "town"))?.related.map((feature) => feature.id)
  ).toEqual(["neighbour", "realm", "way"]);
  expect(await settlements.read(map.reference, "way")).toBeNull();
});
