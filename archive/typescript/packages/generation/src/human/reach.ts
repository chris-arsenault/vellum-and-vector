import type { Band, ReadBand } from "@atlas/domain";
import type { PhysicalField } from "../world/field";

/**
 * What can be reached from each cell of something spread over the land. Every cell holds its
 * own amount and a share of what its neighbours reach, less with every costly step, so an
 * amount is felt far along cheap travel and hardly at all across a range or a strait. This is
 * the one way people's layers act at a distance: a crowd pulls, hungry towns are felt by the
 * farms around them, and spare food is felt by the towns.
 *
 * The share a step passes on falls with the square of its cost against `range`, the travel
 * distance over which an amount fades. That keeps the fading distance the same on a coarse
 * mesh and a fine one. A step passes the same share both ways, so what one cell reaches of
 * another is what the other reaches of it: anything divided among those who reach it adds up
 * to exactly what was there. A reach is a weighted sum whose size depends on the mesh; read
 * it against the reach of the land's own area (`around`) to get a density that does not. The
 * sweeps are bounded, so on a mesh much finer than `range` the reach stops short of it; a
 * fine map inherits the far pattern from its parent.
 */
export interface Passage {
  /** By cell and edge: the share of the neighbour's reach that crosses into the cell. */
  readonly passed: Band;
  /** Edges allowed for per cell in `passed`. */
  readonly stride: number;
}
/** The share of a neighbour's reach that crosses a step of this cost. */
export const passedOn = (cost: number, range: number) =>
  Number.isFinite(cost) ? 1 / (1 + (cost * cost) / (range * range)) : 0;

/** Every step's passage, worked out once for all the reaches of a pass. Release it after. */
export function passage(
  map: PhysicalField,
  step: (from: number, to: number) => number,
  range: number
): Passage {
  const mesh = map.mesh;
  let stride = 0;
  for (let i = 0; i < mesh.count; i++) stride = Math.max(stride, mesh.degree(i));
  const passed = map.coverage.scratch("float64", "human:passage", mesh.count * stride);
  for (let i = 0; i < mesh.count; i++)
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      // The dearer direction prices the step, so both ends pass the same share.
      if (j >= 0)
        passed.set(i * stride + edge, passedOn(Math.max(step(j, i), step(i, j)), range) / stride);
    }
  return { passed, stride };
}
export function reach(
  map: PhysicalField,
  amount: Pick<ReadBand, "get">,
  result: Band,
  { passed, stride }: Passage,
  sweeps = 48
) {
  const mesh = map.mesh,
    next = map.coverage.scratch("float64", "human:reach", mesh.count);
  for (let i = 0; i < mesh.count; i++) result.set(i, amount.get(i));
  for (let sweep = 0; sweep < sweeps; sweep++) {
    for (let i = 0; i < mesh.count; i++) {
      let arriving = 0;
      for (let edge = 0; edge < mesh.degree(i); edge++) {
        const j = mesh.neighbor(i, edge);
        if (j >= 0) arriving += result.get(j) * passed.get(i * stride + edge);
      }
      next.set(i, amount.get(i) + arriving);
    }
    result.copyFrom(next);
  }
  map.coverage.release(next);
  return result;
}
