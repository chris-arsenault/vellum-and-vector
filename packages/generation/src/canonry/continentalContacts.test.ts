import { expect, it, vi } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { tectonicProvinces } from "./provinces";

const motion = vi.hoisted(() => ({ relative: 0 }));
vi.mock("./provinceSites", () => ({
  createProvinceSites: () => [
    { x: -100_000, y: 0, assembly: 1, motionX: 0, motionY: 0 },
    { x: 100_000, y: 0, assembly: 2, motionX: motion.relative, motionY: 1 },
  ],
}));

it.each([-1, 0, 1])(
  "opens continental gaps only for divergence (relative motion %s)",
  (relative) => {
    motion.relative = relative;
    const map = createField(createWorldMesh([0, 0, 400_000, 300_000], 1024, 0));
    const profile = atlasPhysicalProfile({}, { ContinentalWarpStrength: 0 });
    tectonicProvinces(map, physicalContext(73, 0, profile));
    if (relative > 0) {
      expect(map.CrustAssemblySeparation.some((value) => value > 0)).toBe(true);
      expect(map.CrustContinentalFraction.some((value) => value < 500)).toBe(true);
    } else {
      expect(map.CrustAssemblySeparation.every((value) => value === 0)).toBe(true);
      expect(map.CrustContinentalFraction.every((value) => value === 1000)).toBe(true);
      expect(new Set(map.CrustAssemblyIds)).toEqual(new Set([1, 2]));
    }
  }
);

it("preserves continental material when initial assembly separation is disabled", () => {
  motion.relative = 1;
  const map = createField(createWorldMesh([0, 0, 400_000, 300_000], 1024, 0));
  const profile = atlasPhysicalProfile(
    {},
    {
      ContinentalWarpStrength: 0,
      ContinentalAssemblySeparationDepth: 0,
    }
  );
  tectonicProvinces(map, physicalContext(73, 0, profile));
  expect(map.CrustContinentalFraction.every((value) => value === 1000)).toBe(true);
  expect(new Set(map.CrustAssemblyIds)).toEqual(new Set([1, 2]));
});
