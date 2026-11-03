import { cellAt, positionOf } from "./lattice";
import type { RegionalState } from "./state";
import { rulingGrade } from "./ways";

/**
 * The line a way is drawn along. The search runs over the lattice, whose few directions give
 * a path stair steps and long runs ruled along the lattice's axes. Where the ground between
 * two points of the path is dry, crosses no channel the path does not cross and climbs no
 * steeper than the ruling grade, the way runs straight between them at whatever bearing that
 * is; elsewhere it keeps the path.
 */
export function wayLine(state: RegionalState, cells: number[]): number[][] {
  const on = new Set(cells), // hpc-exempt: the cells of one way
    anchors = [0];
  for (let i = 0; i < cells.length - 1;) {
    let j = cells.length - 1;
    while (j > i + 1 && !clear(state, cells[i], cells[j], on)) j--;
    anchors.push(j);
    i = j;
  }
  const mesh = state.physical.map.mesh;
  return anchors.map((k) => {
    const p = positionOf(mesh, cells[k]);
    return [p.x, p.y];
  });
}

/** Whether the straight line between two cells is ground the way could take. */
function clear(state: RegionalState, a: number, b: number, on: Set<number>) {
  const map = state.physical.map,
    mesh = map.mesh,
    pa = positionOf(mesh, a),
    pb = positionOf(mesh, b),
    length = Math.hypot(pb.x - pa.x, pb.y - pa.y),
    steps = Math.max(1, Math.ceil((2 * length) / mesh.spacing));
  let previous = a;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps,
      c = cellAt(mesh, pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t);
    if (c < 0 || map.WaterKindCodes.get(c) !== 0) return false;
    if (map.RiverOrders.get(c) > 0 && !on.has(c)) return false;
    if (c !== previous) {
      const rise = Math.abs(map.Elevation.get(c) - map.Elevation.get(previous)) / 1024,
        run = Math.hypot(mesh.x(c) - mesh.x(previous), mesh.y(c) - mesh.y(previous));
      if (run > 0 && rise / run > rulingGrade) return false;
      previous = c;
    }
  }
  return true;
}
