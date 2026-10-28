import {
  AdaptiveLattice,
  createAdaptiveWorldLattice,
  type AdaptiveSampling,
  type AdaptiveTopology,
  type Bounds,
} from "@atlas/domain";
import type { Geometry } from "geojson";

export { AdaptiveLattice };
/** A region's adaptive leaves as a physical mesh. */
export function adaptivePhysicalMesh(topology: AdaptiveTopology, footprint: Geometry) {
  return new AdaptiveLattice(topology, footprint);
}
/** A region mesh over `bounds` plus `padding`, wrapped east/west when the world is. */
export function createAdaptiveWorldMesh(
  bounds: Bounds,
  sampling: AdaptiveSampling,
  padding: number,
  footprint?: Geometry,
  wrapX = false
) {
  return createAdaptiveWorldLattice(bounds, sampling, padding, footprint, wrapX);
}
