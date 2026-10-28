import { expect, it } from "vitest";
import {
  builtinLayers,
  createAdaptiveTopology,
  createGrid,
  rectangle,
  residentBand,
  spatial,
  type Band,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { createField } from "./field";
import { oceanFootprint } from "./geographicContours";
import { marineRegions } from "./marineRegions";
import { nearestTriangle } from "./mesh";
import { units } from "./math";
import { extractOceans } from "./oceanFeatures";
import { createWorldMesh } from "./worldMesh";

const bounds: [number, number, number, number] = [-1e6, -500_000, 1e6, 500_000];
const shelfBreak = units(800);
const sea = (x: number, y: number, neck: number) =>
  Math.abs(x) < 850_000 && Math.abs(y) < 350_000 && (Math.abs(x) > 150_000 || Math.abs(y) < neck);

/** Coast and depth are supplied directly; no physical schedule supplies preconditions. */
function fixture(
  wet: (x: number, y: number) => boolean,
  depth: (x: number, y: number) => number = () => 3000,
  cylinder = false,
  refined = false
) {
  const footprint = rectangle(bounds);
  const mesh = cylinder
    ? createWorldMesh(bounds, 1600, 0, undefined, undefined, undefined, true)
    : adaptivePhysicalMesh(
        createAdaptiveTopology(bounds, {
          maximumSize: 50_000,
          minimumSize: 25_000,
          refine: ([x, y, e, n]) => refined && x < 200_000 && e > -200_000 && y < 0 && n > -200_000,
        }),
        footprint
      );
  const map = createField(mesh);
  for (let i = 0; i < mesh.count; i++) {
    const water = wet(mesh.x(i), mesh.y(i));
    map.WaterKindCodes.set(i, water ? 1 : 0);
    map.WaterBodyIds.set(i, water ? 1 : 0);
    map.Elevation.set(i, units(water ? -depth(mesh.x(i), mesh.y(i)) : 100));
    map.WaterDepths.set(i, water ? -map.Elevation.get(i) : 0);
  }
  return map;
}
const regions = (map: ReturnType<typeof fixture>) => marineRegions(map, shelfBreak);
const labelAt = (map: ReturnType<typeof fixture>, labels: Band, x: number, y = 0) =>
  labels.get(nearestTriangle(map.mesh, x, y));

it.each([false, true])("separates broad seas at a narrow strait, refined=%s", (refined) => {
  const map = fixture((x, y) => sea(x, y, 50_000), undefined, false, refined);
  const before = Array.from(map.WaterKindCodes);
  const result = regions(map);
  expect(result.regions).toHaveLength(2);
  expect(labelAt(map, result.labels, -500_000)).not.toBe(labelAt(map, result.labels, 500_000));
  for (let i = 0; i < map.mesh.count; i++)
    expect(result.labels.get(i) >= 0).toBe(map.WaterKindCodes.get(i) === 1);
  expect(Array.from(map.WaterKindCodes)).toEqual(before);
  expect(Array.from(regions(map).labels)).toEqual(Array.from(result.labels));
});

it("merges the regions when the strait widens into an uninterrupted sea", () => {
  const narrow = fixture((x, y) => sea(x, y, 50_000));
  const open = fixture((x, y) => sea(x, y, 350_000));
  expect(regions(narrow).regions).toHaveLength(2);
  expect(regions(open).regions).toHaveLength(1);
});

it("uses a shallow sill to distinguish a constricted sea without splitting on a ridge alone", () => {
  // A 450 km passage joins 700 km seas: breadth alone remains above the split ratio,
  // while its shallow sill reduces effective passage breadth below that ratio.
  const wet = (x: number, y: number) => sea(x, y, 225_000);
  const sill = (x: number) => (Math.abs(x) < 150_000 ? 50 : 3000);
  expect(regions(fixture(wet)).regions).toHaveLength(1);
  expect(regions(fixture(wet, sill)).regions).toHaveLength(2);
  expect(regions(fixture((x, y) => sea(x, y, 350_000), sill)).regions).toHaveLength(1);
});

it("does not name minor seafloor depressions or use plate and province borders", () => {
  const map = fixture(
    (x, y) => sea(x, y, 350_000),
    (x, y) => 2500 + 300 * Math.cos(x / 70_000) * Math.cos(y / 70_000)
  );
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustPlateIds.set(i, map.mesh.x(i) < 0 ? 1 : 2);
    map.CrustProvinceIds.set(i, i + 1);
  }
  expect(regions(map).regions).toHaveLength(1);
});

it("keeps separate water bodies separate and excludes lakes and dry ground", () => {
  const map = fixture((x, y) => sea(x, y, 0));
  const lake = nearestTriangle(map.mesh, 0, 0);
  map.WaterKindCodes.set(lake, 2);
  map.WaterDepths.set(lake, units(100));
  const result = regions(map);
  expect(result.regions).toHaveLength(2);
  expect(result.labels.get(lake)).toBe(-1);
  map.WaterKindCodes.fill(0);
  expect(regions(map).regions).toHaveLength(0);
});

it("keeps an all-water cylinder and a sea crossing its chart seam whole", () => {
  expect(regions(fixture(() => true, undefined, true)).regions).toHaveLength(1);
  const map = fixture((x, y) => Math.abs(x) > 600_000 && Math.abs(y) < 300_000, undefined, true);
  const result = regions(map);
  expect(result.regions).toHaveLength(1);
  expect(labelAt(map, result.labels, -800_000)).toBe(labelAt(map, result.labels, 800_000));
});

it("classifies a shallow marine region as a sea", () => {
  const map = fixture(
    (x, y) => sea(x, y, 350_000),
    () => 100
  );
  expect(regions(map).regions.map((region) => region.type)).toEqual(["sea"]);
});

it("names a smaller enclosed basin as a sea beside its larger ocean", () => {
  const map = fixture(
    (x, y) =>
      (x > -850_000 && x < -150_000 && Math.abs(y) < 350_000) ||
      (x > 350_000 && x < 650_000 && Math.abs(y) < 150_000) ||
      (x > -150_000 && x < 350_000 && Math.abs(y) < 30_000)
  );
  const result = regions(map);
  expect(result.regions).toHaveLength(2);
  const bySize = result.regions.sort((a, b) => b.area - a.area);
  expect(bySize.map((region) => region.type)).toEqual(["ocean", "sea"]);
});

function publicationFixture(map: ReturnType<typeof fixture>) {
  const state = landscape();
  const footprint = rectangle(bounds);
  state.domain.world.id = "2f6e0134-6017-4e80-9196-052a12218500";
  state.domain.scope = { ...state.domain.scope, footprint };
  state.domain.world.reference.domain = footprint;
  state.domain.world.areas.area.footprint = footprint;
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((layer) => [layer.id, layer]));
  state.surface = createGrid("marine-fixture", state.domain.scope, 5, 3);
  state.physical = {
    map,
    profile: { ...atlasPhysicalProfile(), ShelfBreakDepth: 800 },
    samples: residentBand("int32", new Int32Array(15)),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 50_000, minimumSize: 25_000, featureSamples: 2 },
  };
  state.surface.ocean = oceanFootprint(state);
  return state;
}

function expectSeaCoverage(state: ReturnType<typeof publicationFixture>, count: number) {
  const features = Object.values(state.domain.world.features);
  expect(features).toHaveLength(count);
  const shapes = features.map((feature) => feature.geometry);
  const union = spatial.unionAll(shapes);
  const missing = spatial.difference(state.surface.ocean!, union);
  expect(missing ? spatial.area(missing) : 0).toBeLessThan(1);
  for (let a = 0; a < shapes.length; a++)
    for (let b = a + 1; b < shapes.length; b++) {
      const overlap = spatial.intersection(shapes[a], shapes[b]);
      expect(overlap ? spatial.area(overlap) : 0).toBeLessThan(1);
    }
  const mesh = state.physical!.map.mesh;
  const covers = shapes.map((shape) => spatial.pointCoverage(shape));
  const { labels } = regions(state.physical!.map);
  const owners = new Map<number, number>();
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) !== 1) continue;
    const label = labels.get(i);
    if (label < 0) continue;
    const hits = covers.flatMap((contains, feature) =>
      contains({ x: mesh.x(i) + mesh.origin[0], y: mesh.y(i) + mesh.origin[1], z: 0 })
        ? [feature]
        : []
    );
    expect(hits, `cell ${i}`).toHaveLength(1);
    if (!owners.has(label)) owners.set(label, hits[0]);
    expect(hits[0]).toBe(owners.get(label));
  }
  expect(new Set(owners.values()).size).toBe(count);
}

it("tiles three joined seas where their naming boundaries meet", () => {
  const centers = [
    [-550_000, -150_000],
    [550_000, -150_000],
    [0, 250_000],
  ];
  const map = fixture(
    (x, y) =>
      centers.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < 200_000) ||
      (Math.abs(x) < 550_000 && Math.abs(y + 150_000) < 35_000) ||
      (Math.abs(x) < 35_000 && y > -150_000 && y < 250_000)
  );
  const state = publicationFixture(map);
  extractOceans(state);
  expectSeaCoverage(state, 3);
});

it("tiles two connected cylinder seas while retaining one identity across the seam", () => {
  const map = fixture(
    (x, y) =>
      Math.abs(y) < 300_000 &&
      (Math.abs(x) > 700_000 || Math.abs(x) < 250_000 || Math.abs(y) < 40_000),
    undefined,
    true
  );
  const state = publicationFixture(map);
  const detected = regions(map).regions.map((region) => ({
    x: map.mesh.x(region.peak),
    y: map.mesh.y(region.peak),
    area: region.area,
    cells: region.members.length,
  }));
  expect(detected, JSON.stringify(detected)).toHaveLength(2);
  extractOceans(state);
  expectSeaCoverage(state, 2);
  const covers = Object.values(state.domain.world.features).map((f) =>
    spatial.pointCoverage(f.geometry)
  );
  expect(covers.findIndex((at) => at({ x: -850_000, y: 0, z: 0 }))).toBe(
    covers.findIndex((at) => at({ x: 850_000, y: 0, z: 0 }))
  );
});

it("publishes distinct names whose nonoverlapping extents cover the authoritative sea", () => {
  const state = publicationFixture(fixture((x, y) => sea(x, y, 50_000)));
  const ocean = state.surface.ocean!;
  extractOceans(state);
  const features = Object.values(state.domain.world.features);
  expect(features).toHaveLength(2);
  expect(new Set(features.map((feature) => feature.name)).size).toBe(2);
  expect(
    features.every((feature) => feature.kind === "ocean" && feature.layerId === "oceans")
  ).toBe(true);
  const shapes = features.map((feature) => feature.geometry);
  const union = spatial.unionAll(shapes);
  const overlap = spatial.intersection(shapes[0], shapes[1]);
  expect(overlap ? spatial.area(overlap) : 0).toBeLessThan(1);
  expect(spatial.area(union) / spatial.area(ocean)).toBeCloseTo(1, 6);
  const missing = spatial.difference(ocean, union);
  expect(missing ? spatial.area(missing) : 0).toBeLessThan(1);
  expect(state.surface.ocean).toBe(ocean);
  const original = structuredClone(features);
  extractOceans(state);
  expect(Object.values(state.domain.world.features)).toEqual(original);
  const current = Object.values(state.domain.world.features);
  current[0].name = "The Kept Sea";
  current[0].protected = true;
  current[1].state = "authored";
  current[1].name = "The Written Ocean";
  extractOceans(state);
  expect(Object.values(state.domain.world.features).map((feature) => feature.name)).toEqual([
    "The Kept Sea",
    "The Written Ocean",
  ]);
});

it("publishes shallow seas using the sea naming descriptor", () => {
  const state = publicationFixture(
    fixture(
      (x, y) => sea(x, y, 350_000),
      () => 100
    )
  );
  extractOceans(state);
  const feature = Object.values(state.domain.world.features)[0];
  expect(feature.name).toMatch(/ Sea$/);
  expect(feature.attributes).toMatchObject({ marineType: "sea", namingSubkind: "sea" });
});
