import type { Band } from "@atlas/domain";
import { neighbors, type RefinementState } from "./state";

/** Standing water is supported by runoff and rain, not by the routing flood's fill height. */
export function fillRegionalLakes(state: RefinementState) {
  const g = state.surface,
    seen = g.coverage.scratch("uint8", "regional:lake-seen", g.active.length),
    spill = g.channels.drainageElevation,
    height = g.channels.elevation;
  for (let i = 0; i < g.active.length; i++) {
    if (seen.get(i) || g.channels.water.get(i) === 1 || spill.get(i) - height.get(i) <= 2) continue;
    const cells = pool(state, i, seen),
      level = waterStage(state, cells, spill.get(i));
    for (const cell of cells) {
      const depth = level - height.get(cell);
      if (depth <= 2) continue;
      g.channels.water.set(cell, 2);
      g.channels.waterDepth.set(cell, depth);
      g.channels.waterLevel.set(cell, level);
    }
  }
  g.coverage.release(seen);
}
function pool(state: RefinementState, start: number, seen: Band) {
  const g = state.surface,
    spill = g.channels.drainageElevation,
    height = g.channels.elevation,
    cells = [start];
  seen.set(start, 1);
  for (let k = 0; k < cells.length; k++)
    for (const j of neighbors(g, cells[k])) {
      if (
        seen.get(j) ||
        Math.abs(spill.get(j) - spill.get(start)) > 1e-6 ||
        spill.get(j) - height.get(j) <= 2
      )
        continue;
      seen.set(j, 1);
      cells.push(j);
    }
  return cells;
}
function waterStage(state: RefinementState, cells: number[], spill: number) {
  const g = state.surface,
    height = g.channels.elevation,
    { inflow, area, temperature } = poolSupply(state, cells);
  const loss = Math.max(0.2, 0.6 + (temperature / area) * 0.03),
    supportedArea = inflow / loss;
  if (supportedArea >= area) return spill;
  cells.sort((a, b) => height.get(a) - height.get(b));
  let covered = 0;
  for (const i of cells) {
    covered += g.measures.get(i);
    if (covered > supportedArea) return height.get(i);
  }
  return spill;
}
function poolSupply(state: RefinementState, cells: number[]) {
  const g = state.surface,
    members = new Set(cells);
  let inflow = 0,
    area = 0,
    temperature = 0;
  for (const i of cells) {
    const measure = g.measures.get(i);
    area += measure;
    inflow += (g.channels.rainfall?.get(i) ?? 0) * measure;
    temperature += (g.channels.temperature?.get(i) ?? 15) * measure;
    for (const j of neighbors(g, i))
      if (!members.has(j) && state.drainage!.receiver.get(j) === i)
        inflow += g.channels.flow.get(j) * 31557600;
  }
  return { inflow, area, temperature };
}
