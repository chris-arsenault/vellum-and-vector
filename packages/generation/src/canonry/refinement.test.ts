import { expect, it } from "vitest";
import { createMesh } from "./mesh";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { units } from "./math";
import { nativeContracts, applyNativeStep } from "./contracts";
import { physicalSchedule } from "./schedule";
import { physicalContext } from "./context";
import { atlasSeaIce } from "./atlasSeaIce";
import { flowRouting } from "./routing";
import { oceanConnectivity } from "./ocean";
import { drainageConditioning } from "./drainageFlood";
import { drainageGuidance } from "./flowGuidance";
import { riverNetwork } from "./rivers";
import { sourceToOutletOrder } from "./flowGraph";
import { depthRateToDischarge } from "./dimensions";

it("drains an inland rectangular world through its work boundary after sea-level fall", () => {
  const map = createField(createWorldMesh([0, 0, 100_000, 100_000], 256, 10_000));
  map.SeaLevelInitialized = true;
  for (let i = 0; i < map.mesh.count; i++) map.Elevation[i] = units(200 + map.mesh.x[i] / 1000);
  map.Runoff.fill(500);
  const context = physicalContext(104729, 0, atlasPhysicalProfile());
  context.SeaLevelOffset = -100;
  oceanConnectivity(map, context);
  expect(map.WaterKindCodes.every((kind) => kind === 0)).toBe(true);
  drainageConditioning(map, context);
  drainageGuidance(map, context);
  flowRouting(map, context);
  riverNetwork(map, context);
  expect(sourceToOutletOrder(map)).toHaveLength(map.mesh.count);
  let exported = 0,
    supplied = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    supplied += depthRateToDischarge(500, map.mesh.areas[i]);
    if (map.FlowTargets[i] < 0) {
      expect(map.mesh.boundary[i]).toBe(1);
      exported += map.FlowAccumulation[i];
    }
  }
  expect(exported).toBeCloseTo(supplied, 8);
  context.SeaLevelOffset = 220;
  oceanConnectivity(map, context);
  drainageConditioning(map, context);
  expect(map.WaterKindCodes.some((kind) => kind === 1)).toBe(true);
  expect(map.DrainageParents.every((parent, i) => map.WaterKindCodes[i] === 1 || parent >= 0)).toBe(
    true
  );
});

it("routes a lake spill across an open patch boundary while requiring water in a closed world", () => {
  const map = createField(createMesh(32, 2)),
    outlet = map.mesh.boundary.findIndex((value) => value === 1),
    lake = map.mesh.neighbors.slice(outlet * 3, outlet * 3 + 3).find((i) => i >= 0)!;
  map.WaterKindCodes[lake] = 2;
  map.WaterBodyIds[lake] = 2;
  map.LakeOutletTargets[lake] = outlet;
  const context = physicalContext(104729, 0, atlasPhysicalProfile());
  expect(() => flowRouting(map, context)).toThrow("Lake spill route does not reach water.");
  map.OpenBoundary = true;
  flowRouting(map, context);
  expect(map.FlowTargets[lake]).toBe(outlet);
  expect(map.FlowTargets[outlet]).toBe(-1);
});

function patch(kind: string) {
  const map = createField(createWorldMesh([0, 0, 400_000, 400_000], 512, 100_000));
  map.OpenBoundary = true;
  map.SeaLevelInitialized = true;
  map.CrustSupportInitialized = true;
  map.CrustThickness.fill(units(kind === "inland" ? 4000 : 1000));
  map.CrustContinentalFraction.fill(kind === "inland" ? 1000 : 0);
  map.CrustTypeCodes.fill(kind === "inland" ? 2 : 1);
  map.RockResistance.fill(1000);
  for (let i = 0; i < map.mesh.count; i++)
    map.Elevation[i] = units(kind === "inland" ? 200 + map.mesh.x[i] / 10_000 : -1800);
  map.BedrockElevation.set(map.Elevation);
  map.CrustSupportElevation.set(map.Elevation);
  for (const contract of Object.values(nativeContracts))
    for (const fact of contract.produces) map.AvailableFacts.add(fact);
  return map;
}
it.each(["inland", "ocean"])(
  "refines an entirely %s patch without manufacturing another geographic domain",
  (kind) => {
    const map = patch(kind),
      profile = atlasPhysicalProfile();
    const epoch = {
      StableName: "refinement",
      TectonicStrength: 0,
      HydrologyStrength: 1000,
      GlaciationStrength: 1000,
      CoastalStrength: 1000,
      TemperatureOffset: 0,
      SeaLevelOffset: 0,
    };
    for (const instruction of physicalSchedule([epoch])) {
      if (["initial-geology", "geology"].includes(instruction.phase)) continue;
      const [name, salt, implementation] = instruction.step;
      applyNativeStep(
        map,
        physicalContext(104729, salt, profile, instruction.epoch, instruction.index, 1),
        [name, salt, name === "sea-ice" ? atlasSeaIce : implementation]
      );
    }
    expect(map.AvailableFacts.has("Validated")).toBe(true);
    expect(
      Array.from(map.WaterKindCodes).every((value) => value === (kind === "inland" ? 0 : 1))
    ).toBe(true);
    if (kind === "inland")
      expect(map.FlowTargets.some((target, i) => target < 0 && map.mesh.boundary[i] === 1)).toBe(
        true
      );
  }
);
