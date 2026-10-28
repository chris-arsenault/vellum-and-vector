import { afterEach, expect, it, vi } from "vitest";
import * as provinceSites from "./provinceSites";
import { tectonicProvinces } from "./provinces";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { deformTectonicBonds } from "./tectonicFracture";

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
  const state = map.tectonics!;
  state.bonds[0].extension = 0.3;
  deformTectonicBonds(map, state, 0);
  tectonicProvinces(map, physicalContext(73, 0, profile));
  let active = 0,
    interior = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    const distance = Math.abs(map.mesh.x(i));
    if (distance < 450) {
      expect(map.TectonicBoundaryCodes.get(i)).toBe(kind);
      expect(map.TectonicBoundaryPairIds.get(i)).toBe((1 << 16) | 2);
      expect(map.TectonicTangentX.get(i)).toBe(0);
      expect(map.TectonicTangentY.get(i)).toBe(1000);
      active++;
    }
    if (distance > 1000) {
      expect(map.TectonicBoundaryCodes.get(i)).toBe(0);
      expect(map.TectonicStrain.get(i)).toBe(0);
      interior++;
    }
  }
  expect(active).toBeGreaterThan(0);
  expect(interior).toBeGreaterThan(active);
});

it("keeps accumulated rift deformation out of distant continental interiors", () => {
  vi.spyOn(provinceSites, "createProvinceSites").mockReturnValue(closeSites(2, true));
  const map = createField(createWorldMesh([-10000, -2000, 10000, 2000], 4096, 0));
  const profile = { ...atlasPhysicalProfile(), ContinentalWarpStrength: 0, RidgeWidth: 1000 };
  tectonicProvinces(map, physicalContext(73, 0, profile));
  map.tectonics!.bonds[0].extension = 0.3;
  tectonicProvinces(map, physicalContext(73, 0, profile));
  tectonicProvinces(map, physicalContext(73, 0, profile));
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.mesh.membership(i) !== 1) continue;
    if (Math.abs(map.mesh.x(i)) < 400) {
      expect(map.CrustAssemblySeparation.get(i)).toBeGreaterThan(0);
      expect(map.CrustRiftStrain.get(i)).toBeGreaterThan(0);
      expect(map.CrustContinentalFraction.get(i)).toBe(1000);
    }
    if (Math.abs(map.mesh.x(i)) > 1500) {
      expect(map.CrustAssemblySeparation.get(i)).toBe(0);
      expect(map.CrustContinentalFraction.get(i)).toBe(1000);
    }
  }
});
