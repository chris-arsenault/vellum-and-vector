import type { BlockCache } from "@atlas/domain";
import { createField } from "../world/field";
import type { PhysicalMesh } from "../world/mesh";
import { groundFixture } from "./groundStorage";

/** Supplied-input fixtures, never a production field factory. Imports are lint-restricted. */
export const createTestField = (mesh: PhysicalMesh, cache?: BlockCache) =>
  groundFixture(createField(mesh, cache));
export type TestPhysicalField = ReturnType<typeof createTestField>;
