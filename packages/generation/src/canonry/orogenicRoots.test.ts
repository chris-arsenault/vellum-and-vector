import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField, type PhysicalField } from "./field";
import { units } from "./math";
import type { OrogenicFrame } from "./orogenicComponents";
import { arcCrustYield } from "./crustTransport";
import { crustFlow, distributeOrogenicRoots, pileUpEarlierShortening } from "./orogenicRoots";
import { createWorldMesh } from "./worldMesh";

const normal = 4000;
const context = () => physicalContext(1, 0, atlasPhysicalProfile());
function continent() {
  const map = createField(createWorldMesh([0, 0, 2_400_000, 2_400_000], 48, 0));
  map.CrustContinentalFraction.fill(1000);
  map.CrustThickness.fill(units(normal));
  map.CrustContinentalColumn.fill(units(normal));
  return map;
}
const middleOf = (map: PhysicalField) => {
  let x = 0,
    y = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    x += map.mesh.x(i);
    y += map.mesh.y(i);
  }
  return { x: x / map.mesh.count, y: y / map.mesh.count };
};
const away = (map: PhysicalField, i: number) => {
  const { x, y } = middleOf(map);
  return Math.hypot(map.mesh.x(i) - x, map.mesh.y(i) - y);
};
function thickCore(map: PhysicalField, column: number) {
  for (let i = 0; i < map.mesh.count; i++)
    if (away(map, i) < 150_000) {
      map.CrustThickness.set(i, units(column));
      map.CrustContinentalColumn.set(i, units(column));
    }
}
const crust = (map: PhysicalField, i: number) => map.CrustThickness.get(i) / 1024;
function volume(map: PhysicalField) {
  let total = 0;
  for (let i = 0; i < map.mesh.count; i++) total += crust(map, i) * map.mesh.area(i);
  return total;
}
/** The mean column at this distance from the middle of the map. */
function ring(map: PhysicalField, from: number, to: number) {
  let total = 0,
    cells = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const d = away(map, i);
    if (d < from || d >= to) continue;
    total += crust(map, i);
    cells++;
  }
  return total / cells;
}

it("spreads over-thick crust outward without making or losing any", () => {
  const map = continent();
  thickCore(map, 12_000);
  const was = volume(map),
    core = ring(map, 0, 100_000);
  crustFlow(map, context());
  expect(ring(map, 0, 100_000)).toBeLessThan(core - 500);
  expect(ring(map, 200_000, 300_000)).toBeGreaterThan(normal + 100);
  expect(ring(map, 1_000_000, 1_100_000)).toBeLessThan(ring(map, 200_000, 300_000));
  expect(volume(map) / was).toBeCloseTo(1, 4);
});

it("leaves crust alone that can hold itself up", () => {
  const map = continent();
  thickCore(map, normal + atlasPhysicalProfile().CrustFlowYield - 100);
  const core = ring(map, 0, 100_000);
  crustFlow(map, context());
  expect(ring(map, 0, 100_000)).toBe(core);
  expect(ring(map, 300_000, 400_000)).toBe(normal);
});

it("lets an old belt's root settle once nothing squeezes it", () => {
  const settled = (squeezed: boolean) => {
    const map = continent();
    thickCore(map, normal + atlasPhysicalProfile().CrustFlowYield - 100);
    crustFlow(map, context(), () => squeezed);
    return ring(map, 0, 100_000);
  };
  expect(settled(false)).toBeLessThan(settled(true) - 100);
});

it("moves more of a column the thicker it stands", () => {
  const share = (column: number) => {
    const map = continent();
    thickCore(map, column);
    const over = ring(map, 0, 100_000) - (normal + atlasPhysicalProfile().CrustFlowYield),
      was = ring(map, 0, 100_000);
    crustFlow(map, context());
    return (was - ring(map, 0, 100_000)) / over;
  };
  expect(share(12_000)).toBeGreaterThan(share(8000));
});

it("does not flow out into ocean crust", () => {
  const map = continent(),
    { x } = middleOf(map);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.x(i) > x + 400_000) {
      map.CrustContinentalFraction.set(i, 0);
      map.CrustContinentalColumn.set(i, 0);
    }
  thickCore(map, 12_000);
  const ocean = Array.from({ length: map.mesh.count }, (_, i) => i).filter(
    (i) => map.CrustContinentalFraction.get(i) === 0
  );
  crustFlow(map, context());
  for (const i of ocean) expect(crust(map, i)).toBe(normal);
});

it("starts a world's belts with crust piled by their strain, less from a slab going down", () => {
  const map = continent(),
    [hard, gentle, slab, quiet] = [0, 1, 2, 3];
  map.CrustContinentalFraction.set(slab, 0);
  map.CrustThickness.set(slab, units(normal));
  for (const [cell, strain] of [
    [hard, 300],
    [gentle, 100],
    [slab, 300],
  ]) {
    map.TectonicBoundaryCodes.set(cell, 1);
    map.TectonicStrain.set(cell, strain);
  }
  pileUpEarlierShortening(map, context());
  const held = (i: number) => map.CrustRootReserve.get(i);
  expect(held(hard)).toBeCloseTo(held(gentle) * 3, 3);
  expect(held(slab)).toBeCloseTo(held(hard) * arcCrustYield, 3);
  expect(held(quiet)).toBe(0);
});

it("settles root crust left behind however thick that makes the column", () => {
  const map = continent(),
    budget = atlasPhysicalProfile().OrogenicRootBudgetMinimum,
    held = units(budget * 8);
  map.OrogenicComponentIds.fill(-1);
  map.CrustRootReserve.fill(held);
  const admitted = distributeOrogenicRoots(map, context(), [], {} as OrogenicFrame);
  map.coverage.release(admitted);
  expect(crust(map, 0)).toBeGreaterThan(normal + budget * 2);
  expect(map.CrustRootReserve.get(0)).toBeLessThan(held);
});
