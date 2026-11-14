import { readFile } from "node:fs/promises";
import { beforeAll, beforeEach, afterEach, expect, it } from "vitest";
import { initializeEngine } from "@atlas/engine";
import type { Database } from "@sqlite.org/sqlite-wasm";
import { sqliteFixture } from "./sqliteFixture";
import { GeometryKernel } from "./geometryKernel";
import { MapPublication } from "./mapPublication";
import { MapCatalog } from "./mapCatalog";
import { MapRegistry } from "./mapRegistry";
import { MapSettlements } from "./mapSettlements";
import { registryFixture, registryRequest } from "./mapRegistryFixture";

let db: Database, kernel: GeometryKernel, catalog: MapCatalog, publication: MapPublication;
beforeAll(async () => {
  await initializeEngine(
    await readFile(new URL("../../engine/dist/atlas_host_bg.wasm", import.meta.url))
  );
});
beforeEach(async () => {
  db = await sqliteFixture();
  kernel = await GeometryKernel.create();
  catalog = new MapCatalog(db, kernel);
  publication = new MapPublication(db, kernel);
});
afterEach(() => {
  db.close();
  kernel.close();
});

it("queries published registry values, sorting, filters, facets and pagination without generation", () => {
  const { map, features } = registryFixture();
  publication.begin(map, null, true);
  publication.append(map.reference, { features });
  const registry = new MapRegistry(catalog),
    request = registryRequest();
  const result = registry.read(map.reference, request);
  expect(result.total).toBe(5);
  expect(result.matching).toBe(2);
  expect(result.rows.map((row) => row.feature.id)).toEqual(["town", "neighbour"]);
  expect(result.columns).toContainEqual({ key: "population", label: "Residents", numeric: true });
  expect(result.facets.categories.status).toEqual(["inhabited"]);
  request.query.attributes = [{ key: "population", min: "15", max: "", text: "" }];
  expect(registry.read(map.reference, request).rows.map((row) => row.feature.id)).toEqual(["town"]);
  request.query.attributes = [];
  request.query.protectedOnly = true;
  expect(registry.read(map.reference, request).matching).toBe(1);
  request.bounds = [20, 20, 30, 30];
  expect(registry.read(map.reference, request).total).toBe(0);
});

it("keeps world-registry rows associated with their independent map revisions", () => {
  const { map, features } = registryFixture();
  publication.begin(map, null, true);
  publication.append(map.reference, { features: [features[0]] });
  const child = structuredClone(map);
  child.reference = { mapId: "child", revision: "one" };
  publication.begin(child, null, true);
  publication.append(child.reference, { features: [features[0]] });
  const request = registryRequest();
  request.scope = "world";
  const rows = new MapRegistry(catalog).read(map.reference, request).rows;
  expect(rows.map((row) => row.reference.mapId)).toEqual(["child", "island"]);
});

it("reads a settlement's ways, neighbouring places and realm from its pinned map", () => {
  const { map, features } = registryFixture();
  publication.begin(map, null, true);
  publication.append(map.reference, { features });
  const settlements = new MapSettlements(catalog);
  expect(settlements.read(map.reference, "town")?.related.map((feature) => feature.id)).toEqual([
    "neighbour",
    "realm",
    "way",
  ]);
  expect(settlements.read(map.reference, "way")).toBeNull();
});
