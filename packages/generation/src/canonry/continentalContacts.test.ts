import { expect, it, vi } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import type { Band } from "@atlas/domain";
import { createField, type PhysicalField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { tectonicProvinces } from "./provinces";

const motion = vi.hoisted(() => ({ relative: 0 }));
vi.mock("./provinceSites", () => ({
  createProvinceSites: () => [
    { x: -100_000, y: 0, assembly: 1, motionX: 0, motionY: 0 },
    { x: 100_000, y: 0, assembly: 2, motionX: motion.relative, motionY: 1 },
  ],
}));

function contentValues(map: PhysicalField, band: Band): number[] {
  const values: number[] = [];
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.membership(i) === 1) values.push(band.get(i));
  return values;
}

it.each([-1, 0, 1])("does not carve a gap from initial relative motion %s", (relative) => {
  motion.relative = relative;
  const map = createField(createWorldMesh([0, 0, 400_000, 300_000], 1024, 0));
  const profile = atlasPhysicalProfile({}, { ContinentalWarpStrength: 0 });
  tectonicProvinces(map, physicalContext(73, 0, profile));
  expect(contentValues(map, map.CrustAssemblySeparation).every((value) => value === 0)).toBe(true);
  expect(contentValues(map, map.CrustContinentalFraction).every((value) => value === 1000)).toBe(
    true
  );
  expect(new Set(contentValues(map, map.CrustAssemblyIds))).toEqual(new Set([1, 2]));
});

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
  expect(contentValues(map, map.CrustContinentalFraction).every((value) => value === 1000)).toBe(
    true
  );
  expect(new Set(contentValues(map, map.CrustAssemblyIds))).toEqual(new Set([1, 2]));
});
