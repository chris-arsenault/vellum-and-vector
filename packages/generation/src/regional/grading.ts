import { units } from "../world/math";
import { distance, isContent, neighborsOf, regionalSpan } from "./lattice";
import type { RegionalState, Seat } from "./state";

/** Relaxation passes over a footprint; each halves what is left of a too-steep step. */
const gradingPasses = 32;

/**
 * People level the ground they build on. The relief's footprint cap holds the derived
 * gradient down, but the amplification, the base's macro steps, the slides and the sea all
 * act after it; this is the last word on the written surface. Inside each seat's footprint
 * every step between neighbours steeper than the seat's gradient is relaxed by moving both
 * sides toward each other (cut above, fill below), so a seat on a scarp stands on a bench cut
 * into it and the scarp's drop gathers at the footprint's edge. Water and river channels are
 * not moved: a town is never graded across its own river.
 */
export function gradeSeats(state: RegionalState) {
  for (const seat of state.regional.evidence?.seats ?? [])
    if (seat.strength === "established" || state.regional.round >= 3) gradeSeat(state, seat);
}

export function gradeSeat(state: RegionalState, seat: Seat) {
  const map = state.physical.map,
    cells = footprint(state, seat),
    inside = new Map(cells.map((cell, k) => [cell, k])),
    h = cells.map((i) => map.Elevation.get(i)),
    network = state.regional.network,
    basin = state.regional.relief?.basin,
    // This round's channels and kept hollows, and the last routing's rivers, stay as they are.
    movable = cells.map((i) => map.RiverOrders.get(i) === 0 && !network?.channel[i] && !basin?.[i]);
  for (let pass = 0; pass < gradingPasses; pass++)
    if (!relax(state, seat, cells, inside, h, movable)) break;
  cells.forEach((i, k) => {
    const delta = Math.round(h[k]) - map.Elevation.get(i);
    if (!delta) return;
    map.Elevation.add(i, delta);
    map.BedrockElevation.add(i, delta);
  });
}

/** The seat's land cells within its footprint reach. */
function footprint(state: RegionalState, seat: Seat) {
  const map = state.physical.map,
    mesh = map.mesh,
    reach = (seat.radius + 0.5) * regionalSpan(state),
    cells: number[] = [];
  for (let i = 0; i < mesh.count; i++)
    if (
      isContent(mesh, i) &&
      map.WaterKindCodes.get(i) === 0 &&
      distance(mesh, seat.cell, i) <= reach
    )
      cells.push(i);
  return cells;
}

/** One pass over every neighbouring pair of the footprint; whether anything moved. */
function relax(
  state: RegionalState,
  seat: Seat,
  cells: number[],
  inside: Map<number, number>,
  h: number[],
  movable: boolean[]
) {
  const mesh = state.physical.map.mesh,
    around = new Int32Array(mesh.stride);
  let moved = false;
  cells.forEach((i, a) => {
    const m = neighborsOf(mesh, i, around);
    for (let k = 0; k < m; k++) {
      const b = inside.get(around[k]);
      if (b === undefined || b <= a) continue;
      moved = level(h, movable, a, b, units(seat.gradient * distance(mesh, i, around[k]))) || moved;
    }
  });
  return moved;
}

/** Bring the pair's step down to `limit`, sharing the change between the sides that move. */
function level(h: number[], movable: boolean[], a: number, b: number, limit: number) {
  const step = h[a] - h[b],
    excess = Math.abs(step) - limit;
  if (excess <= 1 || (!movable[a] && !movable[b])) return false;
  const toward = Math.sign(step) * excess,
    share = movable[a] && movable[b] ? 0.5 : 1;
  if (movable[a]) h[a] -= toward * share;
  if (movable[b]) h[b] += toward * share;
  return true;
}
