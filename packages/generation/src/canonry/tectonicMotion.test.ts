import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasEpoch, atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { tectonicProvinces } from "./provinces";
import { plateAdvection } from "./advection";
import { moveTectonicSites } from "./tectonicState";
import { refreshSiteMotion, updatePlateMotion } from "./tectonicMotion";
import { meshDeltaX } from "./mesh";
import { carryAmount } from "./magicState";
import { backtrackTectonicPoint } from "./tectonicIntegration";
import { buildTransportPlan } from "./transportPlan";

function translatingWorld(myr = 10, index = 0) {
  const map = createField(
    createWorldMesh([0, 0, 2e6, 1e6], 1024, 0, undefined, undefined, undefined, true)
  );
  const p = atlasPhysicalProfile({}, { ContinentalWarpStrength: 0 });
  const epoch = atlasEpoch({
    id: "motion",
    tectonicDurationMyr: myr,
    tectonics: 1,
    hydrology: 1,
    ice: 0,
    coasts: 1,
    temperature: 15,
    seaLevel: 0,
  });
  const context = physicalContext(104729, 0x6b31e7, p, epoch, index, 3);
  tectonicProvinces(map, context);
  const state = map.tectonics!;
  state.plates = [{ id: 1, x: 0, y: 0, motionX: 0.5, motionY: 0, spin: 0 }];
  for (const site of state.sites) {
    site.plate = 1;
    site.driveX = 0.5;
    site.driveY = 0;
  }
  refreshSiteMotion(map, state);
  map.CrustThickness.fill(4000 * 1024);
  map.BedrockElevation.fill(200 * 1024);
  map.Elevation.set(map.BedrockElevation);
  return { map, context };
}

it("uses geological duration and does not exhaust motion at a late epoch index", () => {
  const early = translatingWorld(20, 0),
    late = translatingWorld(20, 99),
    short = translatingWorld(10);
  const x = early.map.tectonics!.sites[0].x;
  for (const { map, context } of [early, late, short]) plateAdvection(map, context);
  const moved = (map: typeof early.map) => meshDeltaX(map.mesh, map.tectonics!.sites[0].x - x);
  expect(moved(early.map)).toBeCloseTo(234_000, 4);
  expect(moved(late.map)).toBeCloseTo(moved(early.map), 5);
  expect(moved(short.map) * 2).toBeCloseTo(moved(early.map), 5);
  expect(early.map.tectonics!.elapsedMyr).toBe(20);
});

it("partitions a rigid-motion interval without changing the material trajectory", () => {
  const whole = translatingWorld(8),
    divided = translatingWorld(4);
  plateAdvection(whole.map, whole.context);
  plateAdvection(divided.map, divided.context);
  plateAdvection(divided.map, divided.context);
  whole.map.tectonics!.sites.forEach((site, i) => {
    expect(site.x).toBeCloseTo(divided.map.tectonics!.sites[i].x, 5);
    expect(site.y).toBeCloseTo(divided.map.tectonics!.sites[i].y, 5);
  });
  expect(whole.map.BedrockElevation).toEqual(divided.map.BedrockElevation);
});

it("carries an amount through every internal transport and across the cylinder seam", () => {
  const { map, context } = translatingWorld(30);
  let stock = new Float64Array(map.mesh.count);
  stock[map.mesh.x.findIndex((x, i) => x > 900_000 && Math.abs(map.mesh.y[i]) < 100_000)] = 100;
  let calls = 0;
  plateAdvection(map, context, () => {
    stock = carryAmount(map, stock);
    calls++;
    expect(stock.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
  });
  expect(calls).toBeGreaterThan(1);
  const west = stock.reduce((sum, value, i) => sum + (map.mesh.x[i] < 0 ? value : 0), 0);
  expect(west).toBeGreaterThan(90);
});

it("rotates a coherent plate without changing pair distances", () => {
  const { map } = translatingWorld();
  const state = map.tectonics!;
  state.sites = state.sites.slice(0, 3);
  state.bonds = [];
  state.sites.forEach((site, i) => {
    site.x = (i - 1) * 100_000;
    site.y = i * 50_000;
  });
  state.plates[0].spin = 1e-6;
  const distance = () =>
    Math.hypot(state.sites[0].x - state.sites[2].x, state.sites[0].y - state.sites[2].y);
  const before = distance();
  moveTectonicSites(map, 100_000);
  expect(distance()).toBeCloseTo(before, 5);
});

it("samples rigid rotation at material cells rather than translating whole provinces", () => {
  const { map, context } = translatingWorld();
  const state = map.tectonics!;
  state.plates[0].spin = 0.8e-6;
  refreshSiteMotion(map, state);
  tectonicProvinces(map, context);
  for (let i = 0; i < map.mesh.count; i++) {
    if (Math.abs(map.mesh.x[i]) > 200_000 || Math.abs(map.mesh.y[i]) > 100_000) continue;
    expect(map.CrustMotionX[i] / 1000).toBeCloseTo(0.5 - state.plates[0].spin * map.mesh.y[i], 2);
    expect(map.CrustMotionY[i] / 1000).toBeCloseTo(state.plates[0].spin * map.mesh.x[i], 2);
  }
});

it("preserves a uniform material column while rotating its cells", () => {
  const { map, context } = translatingWorld();
  map.tectonics!.plates[0].spin = 0.8e-6;
  refreshSiteMotion(map, map.tectonics!);
  tectonicProvinces(map, context);
  const plan = buildTransportPlan(map, 10_000);
  for (let i = 0; i < map.mesh.count; i++) {
    if (Math.abs(map.mesh.x[i]) > 200_000 || Math.abs(map.mesh.y[i]) > 100_000) continue;
    expect(plan.arrivals[i] / 1e6).toBeCloseTo(1, 8);
  }
});

it("forecasts the same translation for authored present-location backtracking", () => {
  const { map } = translatingWorld();
  const before = structuredClone(map.tectonics);
  const point = backtrackTectonicPoint(map, [0, 0], [234_000, 234_000]);
  expect(point[0]).toBeCloseTo(-234_000, 5);
  expect(point[1]).toBeCloseTo(0, 5);
  expect(map.tectonics).toEqual(before);
});

it("responds to converging contacts instead of preserving unrelated seeded velocities", () => {
  const { map } = translatingWorld();
  const state = map.tectonics!;
  state.sites = state.sites.slice(0, 2);
  state.sites.forEach((site, i) => {
    site.x = i ? 100_000 : -100_000;
    site.y = 0;
    site.plate = i + 1;
    site.driveX = i ? -0.5 : 0.5;
  });
  state.plates = state.sites.map((site) => ({
    id: site.plate,
    x: site.x,
    y: 0,
    motionX: site.driveX,
    motionY: 0,
    spin: 0,
  }));
  state.bonds = [
    { a: 0, b: 1, strength: 1, extension: 0, shortening: 0, broken: false, active: true },
  ];
  refreshSiteMotion(map, state);
  updatePlateMotion(map, state, 4);
  const closing = state.plates[0].motionX - state.plates[1].motionX;
  expect(closing).toBeGreaterThan(0);
  expect(closing).toBeLessThan(1);
});
