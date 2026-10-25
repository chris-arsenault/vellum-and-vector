import { expect, it } from "vitest";
import { createField } from "./field";
import { createMesh } from "./mesh";
import { units } from "./math";
import { transportHistory } from "./transportHistory";
import { weightScale, type TransportPlan } from "./transportPlan";

function fixture() {
  const map = createField(createMesh(4, 0));
  map.mesh.areas.set([1, 3, 2, 2]);
  map.CrustThickness.set([units(2000), units(4000), 0, 0]);
  map.CrustContinentalFraction.set([500, 500, 0, 0]);
  map.CrustAssemblyIds.set([7, 3, 0, 0]);
  map.CrustSutureStrength.set([100, 900, 0, 0]);
  map.CrustSuturePairIds.set([12, 34, 0, 0]);
  map.SedimentThickness.set([10, 30, 0, 0]);
  map.TreeCover.set([0.2, 0.8, 0, 0]);
  map.PeatCarbon.set([2.5, 12.5, 0, 0]);
  map.VolcanicConstructionHistory.set([2, 4, 0, 0]);
  map.VolcanicLastActiveEpoch.set([1, 3, -1, -1]);
  map.MaximumIceThickness.set([5, 9, 0, 0]);
  map.FeatureFlags.set([1 << 8, 1 << 9, 0, 0]);
  map.BiomeCodes.set([10, 14, 0, 0]);
  map.TectonicBoundaryCodes[3] = 2;
  const plan: TransportPlan = {
    offsets: Int32Array.from([0, 2, 4, 4, 4]),
    targets: Int32Array.from([2, 3, 2, 3]),
    weights: Float64Array.from([0.5, 0.5, 0.5, 0.1], (v) => v * weightScale),
    arrivals: Float64Array.from([0, 0, 1, 0.4], (v) => v * weightScale),
    dominant: Int32Array.from([-1, -1, 1, 0]),
    dominantWeight: Float64Array.from([0, 0, 0.75, 0.25], (v) => v * weightScale),
  };
  return { map, plan };
}

it("carries area-weighted material, fractional ecology, labels and maxima without losing source state", () => {
  const { map, plan } = fixture();
  transportHistory(map, plan);
  expect([...map.SedimentThickness]).toEqual([0, 0, 25, 7]);
  expect(map.TreeCover[2]).toBeCloseTo(0.65);
  expect(map.TreeCover[3]).toBeCloseTo(0.17);
  expect(map.PeatCarbon[2]).toBeCloseTo(10);
  expect(map.PeatCarbon[3]).toBeCloseTo(2.5);
  expect([...map.CrustAssemblyIds]).toEqual([0, 0, 3, 7]);
  expect([...map.CrustSuturePairIds]).toEqual([0, 0, 34, 34]);
  expect([...map.BiomeCodes]).toEqual([0, 0, 14, 10]);
  expect([...map.MaximumIceThickness]).toEqual([0, 0, 9, 9]);
  expect([...map.VolcanicLastActiveEpoch]).toEqual([-1, -1, 3, 3]);
  expect([...map.FeatureFlags]).toEqual([0, 0, (1 << 8) | (1 << 9), (1 << 8) | (1 << 9)]);
  expect(map.CrustThickness[2]).toBe(units(3500));
  expect(map.CrustThickness[3]).toBe(units(1700));
  expect(map.CrustThickness[0]).toBe(units(1000));
});

it("preserves convergent crust surplus and clears volcanic flags when transported construction is absent", () => {
  const { map, plan } = fixture();
  map.TectonicBoundaryCodes[2] = 1;
  plan.arrivals[2] *= 2;
  plan.weights[0] *= 2;
  plan.weights[2] *= 2;
  map.VolcanicConstructionHistory.fill(0);
  map.FeatureFlags[0] |= 1;
  map.FeatureFlags[1] |= 2;
  transportHistory(map, plan);
  expect(map.ConvergentCrustSurplus[2]).toBe(units(3500));
  expect([...map.FeatureFlags]).toEqual([0, 0, 3, 3]);
  expect([...map.VolcanicLastActiveEpoch]).toEqual([-1, -1, -1, -1]);
  expect(map.CrustThickness[2]).toBe(units(3500));
});
