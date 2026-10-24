import { expect, it } from "vitest";
import {
  canonryMagicPresets,
  createAdaptiveTopology,
  createAdaptiveField,
  builtinLayers,
  rectangle,
  spatial,
} from "@atlas/domain";
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
    samples: map.mesh.leafToCell,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: 250, minimumSize: 250, featureSamples: 2 },
  };
  initializeMagic(state);
  return state;
}
it("publishes all twenty magic rules with meaningful sites, retained courses and extents", () => {
  const state = fixture(),
    mesh = state.physical!.map.mesh;
  const members = [0, 1, 2];
  for (const field of state.physical!.magic!.fields) {
    field.intensity.fill(800);
    field.source[0] = 1000;
    field.origins = [{ id: "origin", x: mesh.x[0], y: mesh.y[0], radius: 100, strength: 1000 }];
    field.parents = new Int32Array(mesh.count).fill(-1);
    field.parents[1] = 0;
    field.parents[2] = 1;
    field.wakePaths = [
      members.map((i) => [mesh.x[i] + mesh.origin[0], mesh.y[i] + mesh.origin[1]]),
    ];
    for (const rule of field.definition.features) {
      const values = new Uint8Array(mesh.count);
      members.forEach((i) => (values[i] = 1));
      field.features[rule.id] = values;
    }
  }
  extractMagicPlaces(state);
  const features = Object.values(state.domain.world.features);
  expect(features).toHaveLength(20);
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
  map.Elevation[0] = 500 * 1024;
  map.Elevation[1] = 450 * 1024;
  map.Elevation[2] = 100 * 1024;
  map.FlowTargets[0] = 1;
  map.FlowTargets[1] = 2;
  expect(naturalPlaceGeometry(state, "waterfall", [0, 1])!.anchor).toBe(1);
  const gorge = naturalPlaceGeometry(state, "gorge", [1], rectangle([0, 0, 4000, 1000]));
  expect(gorge?.geometry.type).toContain("LineString");
  map.LandformCodes[1] = Landform.Gorge;
  extractNamedLandforms(state);
  const f = Object.values(state.domain.world.features).find((x) => x.kind === "gorge")!;
  expect(f.geometry.type).toContain("LineString");
  expect(f.footprint).toBeDefined();
});
it("uses a named interaction participant's course without borrowing unrelated propagation", () => {
  const state = fixture(),
    [fire, aurora, pressure] = state.physical!.magic!.fields,
    count = state.physical!.map.mesh.count;
  fire.parents = new Int32Array(count).fill(-1);
  fire.parents[1] = 0;
  const extent = state.domain.scope.footprint;
  expect(magicPlaceGeometry(state, pressure, "steam", [0, 1], extent)?.geometry.type).toContain(
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
