import { afterEach, expect, it, vi } from "vitest";
import * as provinceSites from "./provinceSites";
import { tectonicProvinces } from "./provinces";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";

afterEach(() => vi.restoreAllMocks());

function closeSites(kind: number, continental = false): provinceSites.ProvinceSite[] {
  return [-1, 1].map((side) => ({
    x: side * 100,
    y: 0,
    priority: 0.5,
    assembly: continental ? (side < 0 ? 1 : 2) : 0,
    motionX: kind === 3 ? 0 : (kind === 1 ? -side : side) * 0.5,
    motionY: kind === 3 ? side * 0.5 : 0,
  }));
}

it.each([1, 2, 3])("keeps a close pair's boundary localized for motion type %s", (kind) => {
  vi.spyOn(provinceSites, "createProvinceSites").mockReturnValue(closeSites(kind));
  const map = createField(createWorldMesh([-10000, -2000, 10000, 2000], 4096, 0));
  const profile = { ...atlasPhysicalProfile(), ContinentalWarpStrength: 0, RidgeWidth: 1000 };
  tectonicProvinces(map, physicalContext(73, 0, profile));
  let active = 0,
    interior = 0;
  for (let i = 0; i < map.mesh.contentCount; i++) {
    const distance = Math.abs(map.mesh.x[i]);
    if (distance < 450) {
      expect(map.TectonicBoundaryCodes[i]).toBe(kind);
      expect(map.TectonicBoundaryPairIds[i]).toBe((1 << 16) | 2);
      expect(map.TectonicTangentX[i]).toBe(0);
      expect(map.TectonicTangentY[i]).toBe(1000);
      active++;
    }
    if (distance > 1000) {
      expect(map.TectonicBoundaryCodes[i]).toBe(0);
      expect(map.TectonicStrain[i]).toBe(0);
      interior++;
    }
  }
  expect(active).toBeGreaterThan(0);
  expect(interior).toBeGreaterThan(active);
});

it("keeps a close continental pair's rift out of its distant interiors", () => {
  vi.spyOn(provinceSites, "createProvinceSites").mockReturnValue(closeSites(2, true));
  const map = createField(createWorldMesh([-10000, -2000, 10000, 2000], 4096, 0));
  const profile = { ...atlasPhysicalProfile(), ContinentalWarpStrength: 0, RidgeWidth: 1000 };
  tectonicProvinces(map, physicalContext(73, 0, profile));
  for (let i = 0; i < map.mesh.contentCount; i++) {
    if (Math.abs(map.mesh.x[i]) < 400) {
      expect(map.CrustAssemblySeparation[i]).toBeGreaterThan(0);
      expect(map.CrustContinentalFraction[i]).toBeLessThan(500);
    }
    if (Math.abs(map.mesh.x[i]) > 1500) {
      expect(map.CrustAssemblySeparation[i]).toBe(0);
      expect(map.CrustContinentalFraction[i]).toBe(1000);
    }
  }
});
