import { expect, it } from "vitest";
import type { Band } from "@atlas/domain";
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
  map.coverage.reduce(
    map.CrustContinentalColumn,
    (sum, value, i) => sum + ((value + map.CrustRootReserve.get(i)) * map.mesh.area(i)) / 1024,
    0
  );
const total = (map: PhysicalField, band: Band) =>
  map.coverage.reduce(band, (sum, value) => sum + value, 0);
const anyLive = (map: PhysicalField, test: (i: number) => boolean) => {
  for (let i = 0; i < map.mesh.count; i++) if (map.mesh.membership(i) !== 0 && test(i)) return true;
  return false;
};

it("preserves a uniform column during resolved periodic translation", () => {
  const map = world();
  map.CrustMotionX.fill(500);
  const plan = buildTransportPlan(map, 100_000);
  transportHistory(map, plan);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) === 0) continue;
    if (Math.abs(map.mesh.y(i)) > 1.5e6 - map.mesh.spacing * 2) continue;
    expect(plan.arrivals.get(i) / 1e6).toBeCloseTo(1, 10);
    expect(map.CrustThickness.get(i) / 1024).toBeCloseTo(4000, 7);
    expect(map.CrustContinentalFraction.get(i)).toBe(1000);
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
        mesh.membership(i) !== 0 &&
        Math.abs(mesh.x(i) - 800_000) < mesh.spacing &&
        side * mesh.y(i) > 1_500_000 - mesh.spacing
      )
        map.SedimentThickness.set(i, units(10));
    const volume = () =>
      map.coverage.reduce(map.SedimentThickness, (sum, value, i) => sum + value * mesh.area(i), 0);
    const before = volume();
    expect(before).toBeGreaterThan(0);
    transportHistory(map, buildTransportPlan(map, mesh.spacing * 2));
    expect(Math.abs(volume() - before) / before).toBeLessThan(1e-11);
    for (let i = 0; i < mesh.count; i++)
      if (mesh.membership(i) !== 0 && map.SedimentThickness.get(i) > 0)
        expect(Math.abs(meshDeltaX(mesh, mesh.x(i) - 800_000))).toBeLessThan(mesh.spacing * 3);
  }
);

it("retains continental convergence as root material instead of discarding normalized overlap", () => {
  const map = world();
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustMotionX.set(i, map.mesh.x(i) < 0 ? 1000 : -1000);
    map.TectonicBoundaryCodes.set(i, 1);
  }
  captureCrustColumns(map);
  const before = continental(map);
  transportHistory(map, buildTransportPlan(map, 50_000));
  expect(anyLive(map, (i) => map.CrustRootReserve.get(i) > 0)).toBe(true);
  expect(
    Math.abs(continental(map) + map.crustBudget.continentalExported - before) / before
  ).toBeLessThan(1e-11);
});

it("creates young oceanic columns in a spreading gap without deleting continental material", () => {
  const map = world();
  for (let i = 0; i < map.mesh.count; i++) {
    map.CrustMotionX.set(i, map.mesh.x(i) < 0 ? -1000 : 1000);
    map.TectonicBoundaryCodes.set(i, 2);
  }
  captureCrustColumns(map);
  const before = continental(map);
  // A newly oceanic core must be wider than the resolved cells, not a mixed edge column.
  transportHistory(map, buildTransportPlan(map, map.mesh.spacing * 4));
  expect(map.crustBudget.oceanCreated).toBeGreaterThan(0);
  expect(
    anyLive(
      map,
      (i) => map.CrustContinentalFraction.get(i) === 0 && Math.abs(map.mesh.x(i)) < 70_000
    )
  ).toBe(true);
  expect(
    Math.abs(continental(map) + map.crustBudget.continentalExported - before) / before
  ).toBeLessThan(1e-11);
});

it("consumes oceanic overlap while retaining continental material", () => {
  const map = world();
  for (let i = 0; i < map.mesh.count; i++) {
    const left = map.mesh.x(i) < 0;
    map.CrustContinentalFraction.set(i, left ? 1000 : 0);
    map.CrustThickness.set(i, units(left ? 4000 : 1000));
    map.CrustMotionX.set(i, left ? 1000 : -1000);
    map.TectonicBoundaryCodes.set(i, 1);
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
    if (Math.abs(map.mesh.x(i)) > 100_000) continue;
    map.CrustRootReserve.set(i, units(200));
    map.TectonicBoundaryCodes.set(i, 1);
    map.TectonicBoundaryPairIds.set(i, 1);
    map.TectonicStrain.set(i, 800);
    map.TectonicTangentY.set(i, 1000);
  }
  captureCrustColumns(map);
  const before = continental(map),
    reserve = total(map, map.CrustRootReserve);
  const context = physicalContext(1, 0, atlasPhysicalProfile());
  context.IsEvolutionEpoch = true;
  orogenicConstruction(map, context);
  expect(total(map, map.CrustRootReserve)).toBeLessThan(reserve);
  expect(Math.abs(continental(map) - before) / before).toBeLessThan(1e-11);
  expect(map.crustBudget.continentalAdjustment).toBe(0);
});
