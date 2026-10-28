import { expect, it } from "vitest";
import { canonryMagicPresets, residentBand, type Landmark } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { initializeMagic, magicBudget } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import {
  emplaceLandmark,
  maintainLandmark,
  remeasureLandmark,
  type LandmarkLedger,
  type LandmarkScene,
} from "./landmarks";
import { landmarkSourceId } from "./landmarkMagic";

/** A coast with Fire configured and no natural heat, so the only vein is the one injected. */
function scenario() {
  const state = landscape(),
    map = createField(
      createAdaptiveWorldMesh(
        [-100_000, -100_000, 100_000, 100_000],
        { maximumSize: 25_000, minimumSize: 6250, refine: () => false },
        0
      )
    );
  state.domain.world.id = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
  state.domain.world.magicSystems = canonryMagicPresets();
  state.domain.world.magic = [];
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: residentBand("int32", new Int32Array(state.surface.active.length)),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  map.RockResistance.fill(1000);
  map.FractureConductance.fill(800);
  for (let i = 0; i < map.mesh.count; i++) {
    map.Temperature.set(i, 320);
    map.Elevation.set(i, Math.round(Math.max(50, map.mesh.x(i) * 0.01) * 1024));
    map.WaterKindCodes.set(i, map.mesh.x(i) < -60_000 ? 1 : 0);
  }
  initializeMagic(state);
  return state;
}
const site = (state: ReturnType<typeof scenario>) => {
  const map = state.physical!.map;
  let best = -1;
  for (let i = 0; i < map.mesh.count; i++)
    if (
      map.mesh.membership(i) === 1 &&
      map.WaterKindCodes.get(i) === 0 &&
      (best < 0 || map.mesh.x(i) > map.mesh.x(best))
    )
      best = i;
  return best;
};

it("injects a kept Fire source, measures its intensity and raises the source to hold it", () => {
  const state = scenario(),
    map = state.physical!.map,
    fire = state.physical!.magic!.fields.find((field) => field.definition.id === "fire")!,
    cell = site(state),
    [x0, y0] = map.mesh.origin,
    landmark: Landmark = {
      id: "5d2f0b6c-1e4a-4b7c-9f3d-2a6e8c0b1d47",
      name: "",
      kind: "fire-wellspring",
      geometry: { type: "Point", coordinates: [map.mesh.x(cell) + x0, map.mesh.y(cell) + y0] },
      parameters: { intensity: 900, reach: 40 },
      emplacedAtEpoch: 0,
      origin: "generated",
    },
    ledger: LandmarkLedger = new Map(),
    scene: LandmarkScene = {
      world: state.domain.world,
      magic: state.physical!.magic,
      scope: { areaId: "area", spaceId: "surface" },
      activity: () => 1,
    },
    evaluate = () => {
      locateMagicSources(state, fire, 42, 0);
      propagateMagic(state, fire, 42, 1);
    };
  const record = emplaceLandmark(map, state.physical!.profile, landmark, 0, ledger, [], scene)!;
  expect(record.realized).toBe(true);
  expect(record.target).toEqual({ intensity: 900 });
  const source = state.domain.world.magic.find(
    (entry) => entry.id === landmarkSourceId(state.domain.world, landmark.id)
  )!;
  expect(source).toMatchObject({
    systemId: "fire",
    landmarkId: landmark.id,
    strength: 900,
    radius: 40_000,
    startsAtEpoch: 0,
    areaId: "area",
    spaceId: "surface",
  });
  expect(source.source.x).toBeCloseTo(map.mesh.x(cell) + x0, 0);

  // The system's own evaluation picks the record up: the vein releases at the site.
  evaluate();
  const held = maintainLandmark(map, state.physical!.profile, landmark, 0, ledger, [], scene)!;
  expect(held.measured.intensity).toBeGreaterThanOrEqual(900);
  expect(fire.located.some((located) => located.id === source.id)).toBe(true);

  // Something lowered the source; maintenance raises it and the next evaluation holds again.
  source.strength = 300;
  evaluate();
  expect(remeasureLandmark(map, landmark, ledger, scene)!.measured.intensity).toBeLessThan(900);
  const raised = maintainLandmark(map, state.physical!.profile, landmark, 1, ledger, [], scene)!;
  expect(raised.strength).toBeGreaterThanOrEqual(900);
  expect(source.strength).toBe(raised.strength);
  evaluate();
  expect(
    remeasureLandmark(map, landmark, ledger, scene)!.measured.intensity
  ).toBeGreaterThanOrEqual(900);
  expect(raised.maintenance).toBe(0);

  const budget = magicBudget(fire, map);
  expect(budget.created).toBeGreaterThan(0);
  for (const value of Object.values(budget)) expect(Number.isFinite(value)).toBe(true);
});

it("notes the cap when the system's activity cannot reach the target", () => {
  const state = scenario(),
    map = state.physical!.map,
    fire = state.physical!.magic!.fields.find((field) => field.definition.id === "fire")!,
    cell = site(state),
    [x0, y0] = map.mesh.origin,
    landmark: Landmark = {
      id: "0c9a7e5b-3d2f-4a18-b6c4-7e1f2d3a4b5c",
      name: "",
      kind: "fire-wellspring",
      geometry: { type: "Point", coordinates: [map.mesh.x(cell) + x0, map.mesh.y(cell) + y0] },
      parameters: { intensity: 900, reach: 40 },
      emplacedAtEpoch: 0,
    },
    ledger: LandmarkLedger = new Map(),
    scene: LandmarkScene = {
      world: state.domain.world,
      magic: state.physical!.magic,
      scope: { areaId: "area", spaceId: "surface" },
      activity: () => 0.5,
    };
  emplaceLandmark(map, state.physical!.profile, landmark, 0, ledger, [], scene);
  locateMagicSources(state, fire, 42, 0);
  propagateMagic(state, fire, 42, 0.5);
  const record = maintainLandmark(map, state.physical!.profile, landmark, 0, ledger, [], scene)!;
  expect(record.strength).toBe(1000);
  expect(record.measured.intensity).toBeLessThan(900);
  expect(record.notes.some((text) => text.includes("caps the source"))).toBe(true);
});

it("forms no source where the system is not generated", () => {
  const state = scenario(),
    map = state.physical!.map,
    cell = site(state),
    [x0, y0] = map.mesh.origin,
    landmark: Landmark = {
      id: "7b3c1d9e-5f4a-4c2b-8d6e-9a0b1c2d3e4f",
      name: "",
      kind: "salt-pan",
      geometry: { type: "Point", coordinates: [map.mesh.x(cell) + x0, map.mesh.y(cell) + y0] },
      parameters: { intensity: 600, reach: 30 },
      emplacedAtEpoch: 0,
    },
    ledger: LandmarkLedger = new Map();
  state.physical!.magic!.fields = state.physical!.magic!.fields.filter(
    (field) => field.definition.id !== "salt"
  );
  const record = emplaceLandmark(map, state.physical!.profile, landmark, 0, ledger, [], {
    world: state.domain.world,
    magic: state.physical!.magic,
    scope: { areaId: "area", spaceId: "surface" },
    activity: () => 1,
  })!;
  expect(state.domain.world.magic).toHaveLength(0);
  expect(record.notes.some((text) => text.includes("not generated"))).toBe(true);
});
