import { expect, it } from "vitest";
import { arcCrustYield, captureCrustColumns, transportCrustColumns } from "../rock/crustTransport";
import type { PhysicalField } from "./field";
import { createTestField as createField } from "../rock/groundTestFixture";
import { units } from "./math";
import { createMesh } from "./mesh";
import { workingArray } from "./physicalNumerics";
import { weightScale, type TransportPlan } from "./transportPlan";

/** The lattice's padding has no area and sends nothing; this is the first cell that has some. */
function realCell(map: PhysicalField) {
  let i = 0;
  while (map.mesh.area(i) <= 0) i++;
  return i;
}
/** Every cell keeps its crust and half as much again arrives in it: pure convergence. */
function pileUp(map: PhysicalField): TransportPlan {
  const count = map.mesh.count,
    offsets = workingArray(map, "int32", "test:offsets", count + 1),
    targets = workingArray(map, "int32", "test:targets", count),
    weights = workingArray(map, "float64", "test:weights", count),
    arrivals = workingArray(map, "float64", "test:arrivals").fill(1.5 * weightScale),
    dominant = workingArray(map, "int32", "test:dominant"),
    dominantWeight = workingArray(map, "float64", "test:dominantWeight");
  const real = realCell(map);
  for (let i = 0; i < count; i++) {
    const hasArea = map.mesh.area(i) > 0;
    offsets.set(i, i);
    targets.set(i, hasArea ? i : real);
    weights.set(i, hasArea ? 1.5 * weightScale : 0);
    dominant.set(i, i);
  }
  offsets.set(count, count);
  return { offsets, targets, weights, arrivals, dominant, dominantWeight };
}
function converge(fraction: number) {
  const map = createField(createMesh(4, 0));
  for (let i = 0; i < map.mesh.count; i++) {
    map.TectonicBoundaryCodes.set(i, 1);
    map.CrustThickness.set(i, units(3000));
    map.CrustContinentalFraction.set(i, fraction);
    map.CrustContinentalColumn.set(i, (units(3000) * fraction) / 1000);
  }
  map.CrustColumnsInitialized = true;
  transportCrustColumns(map, pileUp(map), captureCrustColumns(map));
  return map;
}

it("turns a share of subducted ocean crust into crust for the belt's roots", () => {
  const map = converge(0),
    i = realCell(map);
  expect(map.CrustRootReserve.get(i)).toBeCloseTo(map.OceanicSubduction.get(i) * arcCrustYield);
  expect(map.CrustRootReserve.get(i)).toBeGreaterThan(0);
});
it("lets ocean go down under a continent without shortening the continent", () => {
  const map = createField(createMesh(4, 0)),
    i = realCell(map),
    plan = pileUp(map),
    others = i + 1;
  for (let c = 0; c < map.mesh.count; c++) {
    map.TectonicBoundaryCodes.set(c, 1);
    map.CrustThickness.set(c, units(1000));
  }
  // A continent stays in this cell and half a cell of ocean arrives under it.
  map.CrustThickness.set(i, units(4000));
  map.CrustContinentalColumn.set(i, units(4000));
  map.CrustContinentalFraction.set(i, 1000);
  map.CrustColumnsInitialized = true;
  plan.weights.set(i, weightScale);
  plan.targets.set(others, i);
  plan.weights.set(others, 0.5 * weightScale);
  plan.arrivals.set(i, 1.5 * weightScale);
  transportCrustColumns(map, plan, captureCrustColumns(map));
  expect(map.CrustContinentalColumn.get(i)).toBeCloseTo(units(4000));
  expect(map.CrustThickness.get(i)).toBeCloseTo(units(4000));
  expect(map.OceanicSubduction.get(i)).toBeGreaterThan(0);
});
it("sends all of the excess to the roots where continents collide", () => {
  const map = converge(1000),
    i = realCell(map);
  expect(map.OceanicSubduction.get(i)).toBe(0);
  expect(map.CrustRootReserve.get(i)).toBeCloseTo(units(1500));
});
