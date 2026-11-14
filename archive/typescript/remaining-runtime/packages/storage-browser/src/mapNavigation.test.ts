import { beforeAll, beforeEach, afterEach, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { initializeEngine } from "@atlas/engine";
import type { Database } from "@sqlite.org/sqlite-wasm";
import { type MapFeature, type RegionQuery } from "@atlas/map";
import { sqliteFixture } from "./sqliteFixture";
import { GeometryKernel } from "./geometryKernel";
import { MapPublication } from "./mapPublication";
import { MapCatalog } from "./mapCatalog";
import { BrowserMapNavigation } from "./mapNavigationFacade";
import { descriptor } from "./mapPublicationFixture";
const map = descriptor("navigation"),
  reference = map.reference;
const island: MapFeature = {
  id: "small-island",
  name: "Small island",
  kind: "place",
  typeId: "place",
  layerId: "places",
  spaceId: "surface",
  entityId: null,
  footprint: null,
  relations: [],
  causes: [],
  attributes: {},
  catalog: { values: {}, columns: [], origin: "Generated geography", mapOnly: false },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [2, 2],
        [6, 2],
        [6, 6],
        [2, 6],
        [2, 2],
      ],
    ],
  },
};
const query: RegionQuery = {
  spaceId: "surface",
  parentId: null,
  editingId: null,
  position: [4, 4],
  viewport: map.bounds,
  cuts: [],
};
let db: Database, kernel: GeometryKernel, navigation: BrowserMapNavigation;
beforeAll(async () => {
  await initializeEngine(
    await readFile(new URL("../../engine/dist/atlas_host_bg.wasm", import.meta.url))
  );
});
beforeEach(async () => {
  [db, kernel] = await Promise.all([sqliteFixture(), GeometryKernel.create()]);
  const publication = new MapPublication(db, kernel),
    catalog = new MapCatalog(db, kernel);
  publication.begin(map, null, true);
  publication.append(reference, { features: [island] });
  navigation = new BrowserMapNavigation(catalog, {
    read: async () => {
      throw new Error("No assets in this fixture");
    },
  });
});
afterEach(() => {
  db.close();
  kernel.close();
});

it("chooses a whole indexed island, retains its outline and navigates into it", async () => {
  const initial = await navigation.read(reference);
  const choices = await navigation.choices(reference, initial, query);
  expect(choices.candidates[0].name).toBe("Small island");
  expect(kernel.measure(choices.candidates[0].geometry, 1e-6).area).toBe(16);
  const region = {
    ...choices.candidates[0],
    id: "kept",
    spaceId: "surface",
    parentId: null,
    child: null,
  };
  const kept = await navigation.commit(reference, initial, {
    kind: "putRegion",
    data: region,
  });
  expect((await navigation.choices(reference, kept, query)).childId).toBe("kept");
  const saved = await navigation.commit(reference, kept, {
    kind: "putView",
    data: { id: "view", name: "Island relief", regionId: "kept", settings: { base: "relief" } },
  });
  expect((await navigation.read(reference)).views).toEqual([]);
  expect(saved.views[0].name).toBe("Island relief");
  await expect(
    navigation.commit(reference, saved, { kind: "removeRegion", data: "kept" })
  ).rejects.toThrow();
  await expect(
    navigation.commit(reference, kept, { kind: "removeView", data: "view" })
  ).rejects.toThrow("existing map view");
});
it("cuts a source polygon using the shared Rust and GEOS implementation", async () => {
  const result = await navigation.draw(reference, await navigation.read(reference), {
    query: { ...query, position: null },
    tolerance: 0.2,
    geometry: {
      type: "LineString",
      coordinates: [
        [4, 2.1],
        [4, 5.9],
      ],
    },
  });
  expect(result.candidates).toHaveLength(2);
  expect(result.candidates.map((item) => kernel.measure(item.geometry, 1e-6).area)).toEqual([8, 8]);
});
it("keeps working views independent until an explicit map save", async () => {
  const state = await navigation.read(reference);
  const first = await navigation.commit(reference, state, {
    kind: "putView",
    data: { id: "one", name: "One", regionId: null, settings: {} },
  });
  const second = await navigation.commit(reference, state, {
    kind: "putView",
    data: { id: "two", name: "Two", regionId: null, settings: {} },
  });
  expect(first.views.map((view) => view.name)).toEqual(["One"]);
  expect(second.views.map((view) => view.name)).toEqual(["Two"]);
  expect((await navigation.read(reference)).views).toEqual([]);
});
