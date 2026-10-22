import type { AtlasPhysicalWorkspace } from "./atlasWorkspace";
import { physicalSampler } from "./physicalMetric";

/** Reuse geometric weights across channels; identities always use a discrete sample. */
export function projectedValues(
  work: AtlasPhysicalWorkspace,
  values: ArrayLike<number>,
  discrete = false
) {
  if (!discrete && work.interpolation) {
    const map = work.map,
      mesh = map.mesh,
      at = physicalSampler(mesh, values);
    // Publication sites are retained explicitly instead of reconstructing a second field.
    return Float64Array.from(work.interpolation, (sample) => {
      let x = 0,
        y = 0;
      for (let k = 0; k < sample.cells.length; k++) {
        x += sample.weights[k] * mesh.x[sample.cells[k]];
        y += sample.weights[k] * mesh.y[sample.cells[k]];
      }
      return at(x, y);
    });
  }
  return Float64Array.from(work.samples, (cell) => values[cell]);
}
