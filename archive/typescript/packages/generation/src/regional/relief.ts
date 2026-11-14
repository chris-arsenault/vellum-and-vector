import { MapScale } from "@atlas/domain";
import { measureSlopes } from "../world/geography";
import { physicalGradients } from "../world/physicalMetric";
import { releaseWorking } from "../world/physicalNumerics";
import type { RegionalState } from "./state";

/**
 * Readings of a region's present ground. The ground itself starts as the parent's
 * (`startingGround`) and is worked by the shared processes; nothing here shapes it.
 */

/** Height gradient (m/m) of the present elevation per cell, as two arrays. */
export function heightGradients(state: RegionalState) {
  const map = state.physical.map,
    gradients = physicalGradients(
      map.mesh,
      (i) => MapScale.metres(map.Elevation.get(i), "native"),
      map.coverage
    ),
    gx = new Float64Array(map.mesh.count),
    gy = new Float64Array(map.mesh.count);
  for (let i = 0; i < gx.length; i++) {
    gx[i] = gradients.x.get(i);
    gy[i] = gradients.y.get(i);
  }
  releaseWorking(map, gradients.x, gradients.y);
  return { gx, gy };
}
/** The field's own slope measure, so every reader of `Slope` sees one definition. */
export function updateSlopes(state: RegionalState) {
  measureSlopes(state.physical.map);
}
