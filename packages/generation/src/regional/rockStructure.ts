import { fractalNoise } from "../world/noise";
import { holdRock, transplantHeldColumn, releaseHeldRock } from "../rock/groundTransport";
import { clamp, type RegionalState } from "./state";

/**
 * Refinement samples inherited material packages across their coarse boundaries. This placement
 * does not excavate beds; later ground operations own removal and the resulting exposures.
 */

/** How far columns interfinger, as a share of the parent's cell. */
const interfingerShare = 0.45;

function interfinger(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    seed = state.regional.input.seed,
    wavelength = state.regional.parentSpan,
    reach = wavelength * interfingerShare,
    [west, south, east, north] = mesh.bounds,
    before = holdRock(map);
  for (let i = 0; i < mesh.count; i++) {
    const x = mesh.x(i),
      y = mesh.y(i),
      px = x + mesh.origin[0],
      py = y + mesh.origin[1],
      source = mesh.cellAt(
        clamp(x + fractalNoise(px, py, seed ^ 0x4c1a, wavelength, 3) * reach, west, east),
        clamp(y + fractalNoise(px, py, seed ^ 0x2be7, wavelength, 3) * reach, south, north)
      );
    if (source >= 0 && source !== i) transplantHeldColumn(map, before, i, source);
  }
  releaseHeldRock(map, before);
}
/** The column as the region starts from it, once its character is known. */
export function foldTheColumn(state: RegionalState) {
  interfinger(state);
}
