import type { Band } from "@atlas/domain";
import type { PhysicalField } from "../world/field";
import { releaseWorking, workingArray } from "../world/physicalNumerics";

/**
 * Numerical workspace shared by processes. Specialist domain operations are bound by each consumer.
 */
export interface ProcessTools {
  /** A working band of this map's cells, cleared, to hand back through `release`. */
  scratch(name: string): Band;
  release(...bands: Band[]): void;
}
export const toolsFor = (map: PhysicalField): ProcessTools => ({
  scratch: (name) => workingArray(map, "float64", name).fill(0),
  release: (...bands) => releaseWorking(map, ...bands),
});
