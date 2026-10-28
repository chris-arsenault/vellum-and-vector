import { createWorldLattice } from "@atlas/domain";
import type { PhysicalMesh } from "./mesh";

/** The world lattice: content inside `bounds` and the footprint, a halo of `padding`. */
export function createWorldMesh(
  bounds: [number, number, number, number],
  samples: number,
  padding: number,
  covers: (x: number, y: number) => boolean = () => true,
  area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]),
  anchor?: [number, number],
  wrapX = false,
  closePoles = false
): PhysicalMesh {
  return createWorldLattice(bounds, samples, padding, { covers, area, anchor, wrapX, closePoles });
}
