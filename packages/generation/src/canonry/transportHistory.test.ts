import { expect, it } from "vitest";
import type { Band } from "@atlas/domain";
import { createField } from "./field";
import { createMesh } from "./mesh";
import { units } from "./math";
import { workingValues } from "./physicalNumerics";
import { transportHistory } from "./transportHistory";
import { weightScale, type TransportPlan } from "./transportPlan";

/** The four content cells of the fixture mesh, in ascending cell order. */
function fixture() {
  const map = createField(createMesh(4, 0));
  const cells: number[] = [];
  for (let i = 0; i < map.mesh.count; i++) if (map.mesh.membership(i) === 1) cells.push(i);
  expect(cells.length).toBe(4);
  const areas = new Map(cells.map((cell, k) => [cell, [1, 3, 2, 2][k]]));
  const area = map.mesh.area.bind(map.mesh);
  map.mesh.area = (i) => areas.get(i) ?? area(i);
  map.mesh.contentArea = (i) => areas.get(i) ?? 0;
  const load = (band: Band, values: number[]) =>
    values.forEach((value, k) => band.set(cells[k], value));
  const read = (band: Band) => cells.map((cell) => band.get(cell));
  load(map.CrustThickness, [units(2000), units(4000), 0, 0]);
  load(map.CrustContinentalFraction, [500, 500, 0, 0]);
  load(map.CrustAssemblyIds, [7, 3, 0, 0]);
  load(map.CrustSutureStrength, [100, 900, 0, 0]);
  load(map.CrustSuturePairIds, [12, 34, 0, 0]);
  load(map.SedimentThickness, [10, 30, 0, 0]);
  load(map.TreeCover, [0.2, 0.8, 0, 0]);
  load(map.PeatCarbon, [2.5, 12.5, 0, 0]);
  load(map.VolcanicConstructionHistory, [2, 4, 0, 0]);
  load(map.VolcanicLastActiveEpoch, [1, 3, -1, -1]);
  load(map.MaximumIceThickness, [5, 9, 0, 0]);
  load(map.FeatureFlags, [1 << 8, 1 << 9, 0, 0]);
  load(map.BiomeCodes, [10, 14, 0, 0]);
  map.TectonicBoundaryCodes.set(cells[3], 2);
  const scratch = (type: "float64" | "int32", values: number[], scale = 1) =>
    workingValues(
      map,
      type,
      "test:plan",
      (i) => {
        const k = cells.indexOf(i);
        return (k < 0 ? 0 : values[k]) * scale;
      },
      map.mesh.count
    );
  const dominant = workingValues(
    map,
    "int32",
    "test:plan",
    (i) => {
      const k = cells.indexOf(i);
      return k === 2 ? cells[1] : k === 3 ? cells[0] : -1;
    },
    map.mesh.count
  );
  const plan: TransportPlan = {
    offsets: workingValues(
      map,
      "int32",
      "test:plan",
      (i) => (i <= cells[0] ? 0 : i <= cells[1] ? 2 : 4),
      map.mesh.count + 1
    ),
    targets: Int32Array.from([cells[2], cells[3], cells[2], cells[3]]),
    weights: Float64Array.from([0.5, 0.5, 0.5, 0.1], (v) => v * weightScale),
    arrivals: scratch("float64", [0, 0, 1, 0.4], weightScale),
    dominant,
    dominantWeight: scratch("float64", [0, 0, 0.75, 0.25], weightScale),
  };
  return { map, plan, cells, read };
}

it("carries area-weighted material, fractional ecology, labels and maxima without losing source state", () => {
  const { map, plan, read } = fixture();
  transportHistory(map, plan);
  expect(read(map.SedimentThickness)).toEqual([0, 0, 25, 7]);
  expect(read(map.TreeCover)[2]).toBeCloseTo(0.65);
  expect(read(map.TreeCover)[3]).toBeCloseTo(0.17);
  expect(read(map.PeatCarbon)[2]).toBeCloseTo(10);
  expect(read(map.PeatCarbon)[3]).toBeCloseTo(2.5);
  expect(read(map.CrustAssemblyIds)).toEqual([0, 0, 3, 7]);
  expect(read(map.CrustSuturePairIds)).toEqual([0, 0, 34, 34]);
  expect(read(map.BiomeCodes)).toEqual([0, 0, 14, 10]);
  expect(read(map.MaximumIceThickness)).toEqual([0, 0, 9, 9]);
  expect(read(map.VolcanicLastActiveEpoch)).toEqual([-1, -1, 3, 3]);
  expect(read(map.FeatureFlags)).toEqual([0, 0, (1 << 8) | (1 << 9), (1 << 8) | (1 << 9)]);
  const thickness = read(map.CrustThickness);
  expect(thickness[2]).toBe(units(3500));
  expect(thickness[3]).toBe(units(1700));
  expect(thickness[0]).toBe(units(1000));
});

it("preserves convergent crust surplus and clears volcanic flags when transported construction is absent", () => {
  const { map, plan, cells, read } = fixture();
  // Continental overlap remains available for roots; oceanic overlap is subducted separately.
  map.CrustContinentalFraction.fill(1000);
  map.TectonicBoundaryCodes.set(cells[2], 1);
  plan.arrivals.set(cells[2], plan.arrivals.get(cells[2]) * 2);
  plan.weights[0] *= 2;
  plan.weights[2] *= 2;
  map.VolcanicConstructionHistory.fill(0);
  map.FeatureFlags.set(cells[0], map.FeatureFlags.get(cells[0]) | 1);
  map.FeatureFlags.set(cells[1], map.FeatureFlags.get(cells[1]) | 2);
  transportHistory(map, plan);
  expect(map.ConvergentCrustSurplus.get(cells[2])).toBe(units(3500));
  expect(map.CrustRootReserve.get(cells[2])).toBe(units(3500));
  expect(read(map.FeatureFlags)).toEqual([0, 0, 3, 3]);
  expect(read(map.VolcanicLastActiveEpoch)).toEqual([-1, -1, -1, -1]);
  expect(map.CrustThickness.get(cells[2])).toBe(units(3500));
});
