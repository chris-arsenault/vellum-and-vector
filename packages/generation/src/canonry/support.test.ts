import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { createMesh } from "./mesh";
import { crustHeight, units } from "./math";
import { crustalSupport } from "./support";

function supportDrop(fraction: number, age: number) {
  const profile = atlasPhysicalProfile();
  const map = createField(createMesh(16, 1));
  const foundation = 1000 + 3000 * fraction;
  map.CrustContinentalFraction.fill(Math.round(fraction * 1000));
  map.CrustThickness.fill(units(foundation));
  map.CrustAge.fill(age);
  crustalSupport(map, physicalContext(1, 0, profile), false);
  return (units(crustHeight(foundation, fraction)) - map.CrustSupportTarget[0]) / 1024;
}

it("sinks aged oceanic crust by the full subsidence depth", () => {
  const profile = atlasPhysicalProfile();
  expect(supportDrop(0, 1000)).toBeCloseTo(profile.OceanicSubsidenceDepth, 0);
  expect(supportDrop(0, 500)).toBeCloseTo(profile.OceanicSubsidenceDepth / 2, 0);
});

it("leaves aged continental platforms standing and fades subsidence through the transition", () => {
  const profile = atlasPhysicalProfile();
  expect(supportDrop(0.6, 1000)).toBe(0);
  expect(supportDrop(profile.OceanicSubsidenceCompositionLimit, 1000)).toBe(0);
  const transitional = supportDrop(0.45, 1000);
  expect(transitional).toBeGreaterThan(0);
  expect(transitional).toBeLessThan(profile.OceanicSubsidenceDepth / 4);
});
