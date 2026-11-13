import { MapScale, type BlockCache } from "@atlas/domain";
import { createField } from "../world/field";
import type { PhysicalMesh } from "../world/mesh";
import { groundFixture } from "./groundStorage";
import type { ReachStore } from "../water/reaches";

/** Supplied columns use reference dimensions independently of the small contract lattice. */
export const createTestField = (mesh: PhysicalMesh, cache?: BlockCache) => {
  const map = groundFixture(createField(mesh, cache, MapScale.reference(mesh.spacing)));
  return map as Omit<typeof map, "rivers"> & { rivers: ReachStore };
};
export type TestPhysicalField = ReturnType<typeof createTestField>;
