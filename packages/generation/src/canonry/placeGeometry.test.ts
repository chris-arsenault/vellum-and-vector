import { expect, it } from "vitest";
import {
  canonryMagicPresets,
  createAdaptiveTopology,
  createAdaptiveField,
  builtinLayers,
  rectangle,
  residentBand,
  spatial,
  type AdaptiveLattice,
} from "@atlas/domain";
import { retainedArray } from "./physicalNumerics";
import { landscape } from "../mapFixtures";
import { adaptivePhysicalMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { initializeMagic } from "./magicState";
import { extractMagicPlaces, extractNamedLandforms } from "./geographicRegions";
import { Landform } from "./codes";
import { naturalPlaceGeometry, magicPlaceGeometry } from "./placeGeometry";

function fixture() {
  const state = landscape(),
    topology = createAdaptiveTopology([0, 0, 4000, 1000], { maximumSize: 250, minimumSize: 250 });
  state.domain.world.areas.area.profile = "region";
  state.domain.world.id = state.domain.scope.worldId = "00112233-4455-6677-8899-aabbccddeeff";
  state.domain.world.layers = Object.fromEntries(builtinLayers().map((l) => [l.id, l]));
  state.domain.world.magicSystems = canonryMagicPresets();
  state.surface = createAdaptiveField("places", state.domain.scope, topology);
  const map = createField(adaptivePhysicalMesh(topology, state.domain.scope.footprint));
  map.Elevation.fill(102400);
  map.FlowTargets.fill(-1);
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: residentBand("int32", (map.mesh as AdaptiveLattice).leafCells()),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 250, minimumSize: 250, featureSamples: 2 },
  };
  initializeMagic(state);
  return state;
}
it("publishes a one-cell site but not a one-cell area or course: those stay coverage on the map", () => {
  const state = fixture(),
    mesh = state.physical!.map.mesh,
    fire = state.physical!.magic!.fields[0];
  fire.intensity.fill(800);
  fire.source.set(0, 1000);
  fire.located = [
    { origin: "vein", id: "origin", x: mesh.x(0), y: mesh.y(0), radius: 100, strength: 1000 },
  ];
  fire.parents = retainedArray(state.physical!.map, "int32", "test:parents").fill(-1);
  for (const rule of fire.definition.features) {
    const values = retainedArray(state.physical!.map, "uint8", `test:feature:${rule.id}`);
    values.set(0, 1);
    fire.features[rule.id] = values;
  }
  extractMagicPlaces(state);
  const rules = Object.values(state.domain.world.features).map((f) => String(f.attributes.rule));
  expect(rules.sort()).toEqual(
    fire.definition.features
      .filter((rule) => rule.cartography === "site")
      .map((rule) => rule.id)
      .sort()
  );
});

it("publishes every system rule with meaningful sites, retained courses and extents", () => {
  const state = fixture(),
    map = state.physical!.map,
    mesh = map.mesh;
  const members = [0, 1, 2];
  for (const field of state.physical!.magic!.fields) {
    field.intensity.fill(800);
    field.source.set(0, 1000);
    field.located = [
      { origin: "vein", id: "origin", x: mesh.x(0), y: mesh.y(0), radius: 100, strength: 1000 },
    ];
    field.parents = retainedArray(map, "int32", `test:parents:${field.definition.id}`).fill(-1);
    field.parents.set(1, 0);
    field.parents.set(2, 1);
    field.wakePaths = [
      members.map((i) => [mesh.x(i) + mesh.origin[0], mesh.y(i) + mesh.origin[1]]),
    ];
    for (const rule of field.definition.features) {
      const values = retainedArray(map, "uint8", `test:feature:${field.definition.id}:${rule.id}`);
      members.forEach((i) => values.set(i, 1));
      field.features[rule.id] = values;
    }
  }
  extractMagicPlaces(state);
  const features = Object.values(state.domain.world.features);
  // Every system rule publishes a place; the meetings are confluences with their own places.
  expect(features).toHaveLength(
    state.domain.world.magicSystems!.reduce((sum, system) => sum + system.features.length, 0)
  );
  for (const f of features) {
    const system = state.domain.world.magicSystems!.find((s) => s.id === f.attributes.system)!;
    const rule = system.features.find((r) => r.id === f.attributes.rule)!;
    if (rule.cartography === "site") {
      expect(f.geometry.type).toBe("Point");
      expect(f.footprint?.type).toMatch(/Polygon/);
    } else if (rule.cartography === "course") {
      expect(f.geometry.type, `${system.id}:${rule.id}`).toContain("LineString");
      expect(f.footprint).toBeDefined();
    } else expect(f.geometry.type).toMatch(/Polygon/);
    expect(spatial.covers(state.domain.scope.footprint, f.geometry)).toBe(true);
  }
});
it("anchors a fall to the largest real drop and maps an incised channel through its classified footprint", () => {
  const state = fixture(),
    map = state.physical!.map;
  map.Elevation.set(0, 500 * 1024);
  map.Elevation.set(1, 450 * 1024);
  map.Elevation.set(2, 100 * 1024);
  map.FlowTargets.set(0, 1);
  map.FlowTargets.set(1, 2);
  expect(naturalPlaceGeometry(state, "waterfall", [0, 1])!.anchor).toBe(1);
  const gorge = naturalPlaceGeometry(state, "gorge", [1], rectangle([0, 0, 4000, 1000]));
  expect(gorge?.geometry.type).toContain("LineString");
  map.LandformCodes.set(1, Landform.Gorge);
  extractNamedLandforms(state);
  const f = Object.values(state.domain.world.features).find((x) => x.kind === "gorge")!;
  expect(f.geometry.type).toContain("LineString");
  expect(f.footprint).toBeDefined();
});
it("uses a named interaction participant's course without borrowing unrelated propagation", () => {
  const state = fixture(),
    [fire, aurora, pressure] = state.physical!.magic!.fields,
    map = state.physical!.map;
  fire.parents = retainedArray(map, "int32", "test:parents").fill(-1);
  fire.parents.set(1, 0);
  const extent = state.domain.scope.footprint;
  // A course rule that names Fire as a participant borrows Fire's conduit parents.
  pressure.definition.features.push({
    id: "borrowed",
    name: "Borrowed course",
    priority: 1,
    cartography: "course",
    seeds: [[{ field: "system:fire", min: 1 }]],
  });
  expect(magicPlaceGeometry(state, pressure, "borrowed", [0, 1], extent)?.geometry.type).toContain(
    "LineString"
  );
  const rule = {
    ...aurora.definition.features[0],
    id: "unrelated",
    cartography: "course" as const,
    seeds: [[{ field: "intensity", min: 1 }]],
  };
  aurora.definition.features.push(rule);
  expect(magicPlaceGeometry(state, aurora, rule.id, [0, 1], extent)).toBeNull();
});
