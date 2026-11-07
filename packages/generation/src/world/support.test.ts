import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { createMesh } from "./mesh";
import { crustHeight, units } from "./math";
import { crustalSupport, lithosphericFlexure } from "./support";
import { createWorldMesh } from "./worldMesh";

function supportDrop(fraction: number, age: number) {
  const profile = atlasPhysicalProfile();
  const map = createField(createMesh(16, 1));
  const foundation = 1000 + 3000 * fraction;
  map.CrustContinentalFraction.fill(Math.round(fraction * 1000));
  map.CrustThickness.fill(units(foundation));
  map.CrustAge.fill(age);
  crustalSupport(map, physicalContext(1, 0, profile), false);
  return (units(crustHeight(foundation, fraction)) - map.CrustSupportTarget.get(0)) / 1024;
}

it("does not let deep sea floor pull a continent's edge down", () => {
  const profile = atlasPhysicalProfile(),
    map = createField(createWorldMesh([0, 0, 2_400_000, 2_400_000], 48, 0)),
    ids = Array.from({ length: map.mesh.count }, (_, i) => i),
    middle = ids.reduce((sum, i) => sum + map.mesh.x(i), 0) / ids.length,
    high = units(2000),
    deep = units(-4000);
  for (const i of ids) {
    const land = map.mesh.x(i) < middle;
    map.CrustContinentalFraction.set(i, land ? 1000 : 0);
    map.CrustSupportTarget.set(i, land ? high : deep);
  }
  lithosphericFlexure(map, physicalContext(1, 0, profile));
  for (const i of ids) {
    const want = map.CrustContinentalFraction.get(i) ? high : deep;
    expect(Math.abs(map.CrustSupportElevation.get(i) - want)).toBeLessThan(units(1));
  }
});

it("bends a plate under a narrow load, sharing it among the continent around it", () => {
  const profile = atlasPhysicalProfile(),
    map = createField(createWorldMesh([0, 0, 2_400_000, 2_400_000], 48, 0)),
    ids = Array.from({ length: map.mesh.count }, (_, i) => i),
    middle = ids.reduce((sum, i) => sum + map.mesh.x(i), 0) / ids.length,
    ridge = ids.filter((i) => Math.abs(map.mesh.x(i) - middle) < map.mesh.spacing);
  map.CrustContinentalFraction.fill(1000);
  for (const i of ridge) map.CrustSupportTarget.set(i, units(3000));
  lithosphericFlexure(map, physicalContext(1, 0, profile));
  expect(map.CrustSupportElevation.get(ridge[0])).toBeLessThan(units(3000));
  expect(map.CrustSupportElevation.get(ridge[0])).toBeGreaterThan(0);
});

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
