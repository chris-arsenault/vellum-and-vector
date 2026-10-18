import { expect, it } from "vitest";
import { createMesh } from "./mesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { units } from "./math";
import { nativeContracts, applyNativeStep } from "./contracts";
import { physicalSchedule } from "./schedule";
import { physicalContext } from "./context";
import { atlasSeaIce } from "./atlasSeaIce";
import { flowRouting } from "./routing";

it("routes a lake spill across an open patch boundary while requiring water in a closed world", () => {
  const map = createField(createMesh(32, 2)),
    outlet = map.mesh.boundary.findIndex((value) => value === 1),
    lake = map.mesh.neighbors.slice(outlet * 3, outlet * 3 + 3).find((i) => i >= 0)!;
  map.WaterKindCodes[lake] = 2;
  map.WaterBodyIds[lake] = 2;
  map.LakeOutletTargets[lake] = outlet;
  const context = physicalContext(104729, 0, atlasPhysicalProfile(32));
  expect(() => flowRouting(map, context)).toThrow("Lake spill route does not reach water.");
  map.OpenBoundary = true;
  flowRouting(map, context);
  expect(map.FlowTargets[lake]).toBe(outlet);
  expect(map.FlowTargets[outlet]).toBe(-1);
});

function patch(kind: string) {
  const map = createField(createMesh(512, 8));
  map.OpenBoundary = true;
  map.SeaLevelInitialized = true;
  map.CrustSupportInitialized = true;
  map.CrustThickness.fill(units(kind === "inland" ? 4000 : 1000));
  map.CrustContinentalFraction.fill(kind === "inland" ? 1000 : 0);
  map.CrustTypeCodes.fill(kind === "inland" ? 2 : 1);
  map.RockResistance.fill(1000);
  for (let i = 0; i < map.mesh.count; i++)
    map.Elevation[i] = units(kind === "inland" ? 200 + map.mesh.x[i] : -1800);
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
      profile = atlasPhysicalProfile(512);
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
