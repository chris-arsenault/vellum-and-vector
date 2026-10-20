import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { triangleValue } from "./triangleSampling";

/** Reuse geometric weights across channels; identities always use a discrete sample. */
export function projectedValues(
  work: AtlasPhysicalWorkspace,
  values: ArrayLike<number>,
  discrete = false
) {
  return Float64Array.from(work.samples, (cell, i) =>
    !discrete && work.interpolation ? triangleValue(work.interpolation[i], values) : values[cell]
  );
}
