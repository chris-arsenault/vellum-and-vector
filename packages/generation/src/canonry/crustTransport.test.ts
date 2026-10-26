import { expect, it } from "vitest";
import { createField, type PhysicalField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { buildTransportPlan } from "./transportPlan";
import { transportHistory } from "./transportHistory";
import { captureCrustColumns } from "./crustTransport";
import { units } from "./math";
import { physicalContext } from "./context";
import { atlasPhysicalProfile } from "./atlasProfile";
import { orogenicConstruction } from "./orogeny";
import { meshDeltaX } from "./mesh";

function world(poles = false) {
  const map = createField(
    createWorldMesh([0, 0, 4e6, 3e6], 4096, 0, undefined, undefined, undefined, true, poles)
  );
  map.CrustThickness.fill(units(4000));
  map.CrustContinentalFraction.fill(1000);
  return map;
}
const continental = (map: PhysicalField) =>
  map.CrustContinentalColumn.reduce(
    (sum, value, i) => sum + ((value + map.CrustRootReserve[i]) * map.mesh.areas[i]) / 1024,
    0
  );

it("preserves a uniform column during resolved periodic translation", () => {
  const map = world();
  map.CrustMotionX.fill(500);
  const plan = buildTransportPlan(map, 100_000);
  transportHistory(map, plan);
  for (let i = 0; i < map.mesh.count; i++) {
    if (Math.abs(map.mesh.y[i]) > 1.5e6 - map.mesh.spacing * 2) continue;
    expect(plan.arrivals[i] / 1e6).toBeCloseTo(1, 10);
    expect(map.CrustThickness[i] / 1024).toBeCloseTo(4000, 7);
    expect(map.CrustContinentalFraction[i]).toBe(1000);
  }
});

it.each([false, true])(
  "accounts for all continental material during translation, poles=%s",
  (poles) => {
    const map = world(poles);
    map.CrustMotionX.fill(500);
    captureCrustColumns(map);
    const before = continental(map);
    transportHistory(map, buildTransportPlan(map, 100_000));
    expect(
      Math.abs(continental(map) + map.crustBudget.continentalExported - before) / before
    ).toBeLessThan(1e-11);
  }
);

it.each([-1, 1])(
  "reflects material locally at the %s closed latitude edge without losing volume",
  (side) => {
    const map = world(true),
      mesh = map.mesh;
    map.CrustMotionY.fill(side * 1000);
    for (let i = 0; i < mesh.count; i++)
      if (
        Math.abs(mesh.x[i] - 800_000) < mesh.spacing &&
        side * mesh.y[i] > 1_500_000 - mesh.spacing
      )
        map.SedimentThickness[i] = units(10);
    const volume = () =>
      map.SedimentThickness.reduce((sum, value, i) => sum + value * mesh.areas[i], 0);
    const before = volume();
    expect(before).toBeGreaterThan(0);
    transportHistory(map, buildTransportPlan(map, mesh.spacing * 2));
    expect(Math.abs(volume() - before) / before).toBeLessThan(1e-11);
    for (let i = 0; i < mesh.count; i++)
      if (map.SedimentThickness[i] > 0)
        expect(Math.abs(meshDeltaX(mesh, mesh.x[i] - 800_000))).toBeLessThan(mesh.spacing * 3);
  }
);

it("retains continental convergence as root material instead of discarding normalized overlap", () => {
  const map = world();
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustMotionX[i] = map.mesh.x[i] < 0 ? 1000 : -1000;
    map.TectonicBoundaryCodes[i] = 1;
  }
  captureCrustColumns(map);
  const before = continental(map);
  transportHistory(map, buildTransportPlan(map, 50_000));
  expect(map.CrustRootReserve.some((value) => value > 0)).toBe(true);
  expect(
    Math.abs(continental(map) + map.crustBudget.continentalExported - before) / before
  ).toBeLessThan(1e-11);
});

it("creates young oceanic columns in a spreading gap without deleting continental material", () => {
  const map = world();
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustMotionX[i] = map.mesh.x[i] < 0 ? -1000 : 1000;
    map.TectonicBoundaryCodes[i] = 2;
  }
  captureCrustColumns(map);
  const before = continental(map);
  // A newly oceanic core must be wider than the resolved cells, not a mixed edge column.
  transportHistory(map, buildTransportPlan(map, map.mesh.spacing * 4));
  expect(map.crustBudget.oceanCreated).toBeGreaterThan(0);
  expect(
    map.CrustContinentalFraction.some((value, i) => value === 0 && Math.abs(map.mesh.x[i]) < 70_000)
  ).toBe(true);
  expect(
    Math.abs(continental(map) + map.crustBudget.continentalExported - before) / before
  ).toBeLessThan(1e-11);
});

it("consumes oceanic overlap while retaining continental material", () => {
  const map = world();
  for (let i = 0; i < map.mesh.count; i++) {
    const left = map.mesh.x[i] < 0;
    map.CrustContinentalFraction[i] = left ? 1000 : 0;
    map.CrustThickness[i] = units(left ? 4000 : 1000);
    map.CrustMotionX[i] = left ? 1000 : -1000;
    map.TectonicBoundaryCodes[i] = 1;
  }
  captureCrustColumns(map);
  const before = continental(map);
  transportHistory(map, buildTransportPlan(map, 70_000));
  expect(map.crustBudget.oceanConsumed).toBeGreaterThan(0);
  expect(
    Math.abs(continental(map) + map.crustBudget.continentalExported - before) / before
  ).toBeLessThan(1e-11);
});

it("builds mountain roots from retained shortening without manufacturing continental material", () => {
  const map = world();
  for (let i = 0; i < map.mesh.count; i++) {
    if (Math.abs(map.mesh.x[i]) > 100_000) continue;
    map.CrustRootReserve[i] = units(200);
    map.TectonicBoundaryCodes[i] = 1;
    map.TectonicBoundaryPairIds[i] = 1;
    map.TectonicStrain[i] = 800;
    map.TectonicTangentY[i] = 1000;
  }
  captureCrustColumns(map);
  const before = continental(map),
    reserve = map.CrustRootReserve.reduce((a, b) => a + b, 0);
  const context = physicalContext(1, 0, atlasPhysicalProfile());
  context.IsEvolutionEpoch = true;
  orogenicConstruction(map, context);
  expect(map.CrustRootReserve.reduce((a, b) => a + b, 0)).toBeLessThan(reserve);
  expect(Math.abs(continental(map) - before) / before).toBeLessThan(1e-11);
  expect(map.crustBudget.continentalAdjustment).toBe(0);
});
