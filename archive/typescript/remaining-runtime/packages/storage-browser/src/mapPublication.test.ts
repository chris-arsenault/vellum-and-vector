import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { initializeEngine } from "@atlas/engine";
import type { Database } from "@sqlite.org/sqlite-wasm";
import type { MapDescriptor, MapSample, MapFeature } from "@atlas/map";
import { sqliteFixture } from "./sqliteFixture";
import { GeometryKernel } from "./geometryKernel";
import { MapPublication } from "./mapPublication";
import { MapCatalog } from "./mapCatalog";
import { MapInteractions } from "./mapInteractions";
import { descriptor, rectangle, sample } from "./mapPublicationFixture";
import { BrowserMapLibrary } from "./mapLibrary";
let db: Database, kernel: GeometryKernel, publish: MapPublication, maps: MapCatalog;
function publishPlaces(map: MapDescriptor) {
  publish.append(map.reference, {
    assets: [
      {
        id: "places",
        mediaType: "application/geo+json",
        location: `maps/${map.reference.revision}/places.json`,
        byteLength: 100,
        illustration: false,
      },
      {
        id: "height",
        mediaType: "image/tiff",
        location: `maps/${map.reference.revision}/height.tif`,
        byteLength: 100,
        illustration: false,
      },
    ],
  });
}
function completedMap() {
  const map = descriptor("one");
  publish.begin(map, null, true);
  publishPlaces(map);
  publish.finish(map.reference);
  return map.reference;
}
describe("published map catalog", () => {
  beforeAll(async () => {
    await initializeEngine(
      await readFile(new URL("../../engine/dist/atlas_host_bg.wasm", import.meta.url))
    );
  });
  beforeEach(async () => {
    [db, kernel] = await Promise.all([sqliteFixture(), GeometryKernel.create()]);
    publish = new MapPublication(db, kernel);
    maps = new MapCatalog(db, kernel);
  });
  afterEach(() => {
    db.close();
    kernel.close();
  });
  it(
    "reads finalized geography and original sample attributes without generation tables",
    readPublishedMap
  );
  it("keeps an atomic replacement private and leaves old revisions available", atomicReplacement);
  it(
    "retains an interrupted progressive map and discards an unpublished replacement",
    interruptedPublication
  );
  it("inspects published values and causes and resolves whole feature geography", inspectAndSelect);
  it("uses geometry after indexed candidate paging without losing the continuation", spatialPaging);
  it("restores packed band values, metadata and explicit category labels", packedAttributes);
  it("returns one sample at shared cell edges and keeps the outside map edge", sampleOwnership);
  it("picks nearby lines and places but only polygons covering the clicked point", pickingAreas);
  it("pins explicit saves independently from working publication and views", explicitSave);
  it("rejects malformed map contracts through the shared Rust validator", () => {
    const map = descriptor("invalid");
    map.spaces[0].precision = 0;
    expect(() => publish.begin(map, null, true)).toThrow("finite frames");
    expect(() => maps.head("island")).toThrow("not found");
  });
});
async function explicitSave() {
  const reference = completedMap(),
    library = new BrowserMapLibrary(maps);
  expect((await library.list()).items).toEqual([]);
  const request = {
    reference,
    expectedVersion: null,
    navigation: { version: 0, regions: [], views: [] },
    settings: { base: "relief" },
  };
  const saved = await library.save(request);
  const working = {
    version: 1,
    regions: [],
    views: [{ id: "new", name: "New view", regionId: null, settings: {} }],
  };
  const replacement = descriptor("two");
  publish.begin(replacement, reference, false);
  publishPlaces(replacement);
  publish.finish(replacement.reference);
  expect(await library.open(reference.mapId)).toEqual(saved);
  await expect(library.save(request)).rejects.toThrow("saved map changed");
  const next = await library.save({
    ...request,
    reference: replacement.reference,
    expectedVersion: saved.version,
    navigation: working,
  });
  expect(next.version).toBe(2);
  expect(next.reference).toEqual(replacement.reference);
  expect(next.navigation.views).toEqual(working.views);
  const incomplete = descriptor("partial");
  publish.begin(incomplete, replacement.reference, false);
  await expect(
    library.save({ ...request, reference: incomplete.reference, expectedVersion: next.version })
  ).rejects.toThrow("Complete the map");
}
function box([w, s, e, n]: MapSample["window"]["bounds"]): MapSample["footprint"] {
  return {
    type: "Polygon",
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}
function sampleOwnership() {
  const map = descriptor("edges");
  publish.begin(map, null, true);
  const windows: MapSample["window"][] = [
    { bounds: [0, 0, 5, 10], closedEast: false, closedNorth: true },
    { bounds: [5, 0, 10, 5], closedEast: true, closedNorth: false },
    { bounds: [5, 5, 10, 10], closedEast: true, closedNorth: true },
  ];
  publish.append(map.reference, {
    samples: windows.map((window, i) => ({
      ...sample,
      id: String(i),
      footprint: box(window.bounds),
      window,
    })),
  });
  expect(maps.samplesAt(map.reference, "surface", [5, 5]).map((sample) => sample.id)).toEqual([
    "2",
  ]);
  expect(maps.samplesAt(map.reference, "surface", [10, 10]).map((sample) => sample.id)).toEqual([
    "2",
  ]);
}
function pickingAreas() {
  const map = descriptor("picking");
  publish.begin(map, null, true);
  publish.append(map.reference, {
    samples: [sample],
    features: [
      feature("containing", rectangle),
      feature("adjacent", box([6, 6, 9, 9])),
      feature("place", { type: "Point", coordinates: [6, 6] }),
      feature("line", {
        type: "LineString",
        coordinates: [
          [6, 0],
          [6, 10],
        ],
      }),
    ],
  });
  const inspected = new MapInteractions(maps).inspect(map.reference, {
    spaceId: "surface",
    position: [5, 5],
    tolerance: 2,
  });
  expect(inspected.features.map((feature) => feature.id)).toEqual(["place", "line", "containing"]);
}
function packedAttributes() {
  const map = descriptor("packed");
  const source = map.layers.find((layer) => layer.id === "height")!.source;
  if (source.kind !== "raster") throw new Error("Expected a raster fixture.");
  source.data.bands[0].categories = [
    { value: 25, label: "High", color: null, surface: null, present: true },
  ];
  publish.begin(map, null, true);
  const records = ["High", null, "Surveyed summit"].map((category, index) => ({
    ...sample,
    id: String(index),
    attributes: [{ ...sample.attributes[0], category }],
  }));
  publish.append(map.reference, { samples: records });
  const restored = maps.samplesAt(map.reference, "surface", [5, 5]);
  expect(restored.map((sample) => sample.attributes)).toEqual(
    records.map((sample) => sample.attributes)
  );
  expect(restored[0]).toMatchObject({ center: [5, 5], measure: 100, active: true });
}
function readPublishedMap() {
  const map = descriptor("one");
  publish.begin(map, null, true);
  publish.append(map.reference, {
    entities: [{ id: "realm", name: "Coastal union", kind: "polity", people: 1200, places: 3 }],
    features: [
      {
        id: "peak",
        spaceId: "surface",
        entityId: null,
        layerId: "places",
        name: "Peak",
        geometry: { type: "Point", coordinates: [5, 5] },
        attributes: { height: 25 },
        kind: "place",
        typeId: "place",
        catalog: { values: {}, columns: [], origin: "Generated geography", mapOnly: false },
        footprint: null,
        relations: [],
        causes: [],
      },
    ],
    samples: [sample],
    history: [
      {
        id: "history",
        title: "Mountains",
        description: "Raised ground",
        epoch: 2,
        featureIds: ["peak"],
        attributes: {},
      },
    ],
  });
  expect(() => publish.finish(map.reference)).toThrow("missing published asset");
  publishPlaces(map);
  publish.finish(map.reference);
  expect(maps.open(map.reference).state).toBe("complete");
  expect(maps.samplesAt(map.reference, "surface", [5, 5])[0].attributes[0].value).toBe(25);
  expect(maps.samplesAt(map.reference, "surface", [11, 5])).toEqual([]);
  expect(
    maps.features(map.reference, { spaceId: "surface", bounds: [4, 4, 6, 6] }).items[0].id
  ).toBe("peak");
  expect(maps.history(map.reference).items[0].featureIds).toEqual(["peak"]);
  expect(maps.entities(map.reference, ["realm", "absent"])).toEqual([
    { id: "realm", name: "Coastal union", kind: "polity", people: 1200, places: 3 },
  ]);
  expect(
    db.selectValue(
      "SELECT count(*) FROM sqlite_master WHERE name IN ('worlds','resources','records_core')"
    )
  ).toBe(0);
}
function atomicReplacement() {
  const previous = completedMap(),
    next = descriptor("two");
  publish.begin(next, previous, false);
  publishPlaces(next);
  expect(maps.head("island")).toEqual(previous);
  publish.finish(next.reference);
  expect(maps.head("island")).toEqual(next.reference);
  expect(maps.open(previous).state).toBe("complete");
  expect(() => publish.append(previous, { samples: [sample] })).toThrow("not open");
}
function interruptedPublication() {
  completedMap();
  const initial = descriptor("partial");
  initial.reference.mapId = "new-island";
  publish.begin(initial, null, true);
  publish.append(initial.reference, { samples: [sample] });
  publish.discard(initial.reference);
  expect(maps.open(initial.reference).state).toBe("incomplete");
  expect(maps.samplesAt(initial.reference, "surface", [5, 5])).toHaveLength(1);
  const replacement = descriptor("discarded");
  publish.begin(replacement, maps.head("island"), false);
  publish.discard(replacement.reference);
  expect(() => maps.open(replacement.reference)).toThrow("not found");
}

function feature(id: string, geometry: MapFeature["geometry"]): MapFeature {
  return {
    id,
    geometry,
    spaceId: "surface",
    layerId: "places",
    entityId: null,
    name: id,
    attributes: {},
    kind: "place",
    typeId: "place",
    catalog: { values: {}, columns: [], origin: "Generated geography", mapOnly: false },
    footprint: null,
    relations: [],
    causes: [],
  };
}
function inspectAndSelect() {
  const map = descriptor("one");
  map.spaces[0].periodicWidth = 10;
  publish.begin(map, null, true);
  publish.append(map.reference, {
    samples: [sample],
    features: [feature("island-outline", rectangle)],
    history: [
      {
        id: "island-history",
        title: "Island",
        description: "Raised",
        epoch: 1,
        featureIds: ["island-outline"],
        attributes: {},
      },
    ],
  });
  publishPlaces(map);
  publish.finish(map.reference);
  const interaction = new MapInteractions(maps);
  const inspected = interaction.inspect(map.reference, { spaceId: "surface", position: [15, 5] });
  expect(inspected.position).toEqual([5, 5]);
  expect(inspected.samples[0]).toMatchObject({ value: 25, cellSpan: 10, unit: "metre" });
  expect(inspected.sections[0].records).toEqual([{ name: "Basalt", thickness: 12 }]);
  expect(inspected.causes.map((cause) => cause.id)).toEqual(["island-history"]);
  const selected = interaction.selectRegion(map.reference, {
    spaceId: "surface",
    featureIds: ["island-outline"],
  });
  expect(selected.parent).toEqual(map.reference);
  expect(kernel.measure(selected.geometry, 1e-6).area).toBe(100);
  const replacement = descriptor("two");
  publish.begin(replacement, map.reference, false);
  publishPlaces(replacement);
  publish.finish(replacement.reference);
  expect(
    interaction.selectRegion(map.reference, { spaceId: "surface", featureIds: ["island-outline"] })
      .parent
  ).toEqual(map.reference);
  expect(() =>
    interaction.selectRegion(replacement.reference, {
      spaceId: "surface",
      featureIds: ["island-outline"],
    })
  ).toThrow("absent");
}
function spatialPaging() {
  const map = descriptor("one");
  publish.begin(map, null, true);
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
  publish.append(map.reference, {
    features: [
      ...Array.from({ length: 256 }, (_, i) => feature(String(i).padStart(3, "0"), hollow)),
      feature("last", rectangle),
    ],
  });
  const query = {
    spaceId: "surface",
    geometry: { type: "Point" as const, coordinates: [5, 5] as [number, number] },
  };
  const first = maps.features(map.reference, query);
  expect(first.items).toEqual([]);
  expect(first.next).toBe("255");
  const second = maps.features(map.reference, { ...query, cursor: first.next! });
  expect(second.items.map((item) => item.id)).toEqual(["last"]);
  expect(second.next).toBeNull();
}
