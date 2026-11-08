import { MapScale, type BlockCache } from "@atlas/domain";
import { createField } from "../world/field";
import type { PhysicalMesh } from "../world/mesh";
import { groundFixture } from "./groundStorage";

/** Supplied columns use reference dimensions independently of the small contract lattice. */
export const createTestField = (mesh: PhysicalMesh, cache?: BlockCache) =>
  groundFixture(createField(mesh, cache, MapScale.reference(mesh.spacing)));
export type TestPhysicalField = ReturnType<typeof createTestField>;
