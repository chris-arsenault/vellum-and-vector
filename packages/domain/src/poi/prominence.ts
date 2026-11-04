import type { PoiMap } from "./poiTypes";
import { isLand } from "./mapSearch";

/** A land high point, its prominence and the col that joins it to higher ground. */
export interface Peak {
  cell: number;
  /** Height above its key col, or above sea level for the highest point of its land. */
  prominence: number;
  /** The key col: the highest cell on any route to higher ground; -1 for a land's top. */
  col: number;
}

/**
 * Topographic prominence of every land high point, exactly over the lattice: land cells are
 * taken from highest to lowest, each joins the higher ground its processed neighbours belong
 * to, and where two bodies of higher ground meet the lower top's prominence is its height
 * above that meeting cell, its key col.
 */
export function landPeaks(map: PoiMap): Peak[] {
  const height = (cell: number) => map.read("elevation", cell),
    order: number[] = [];
  for (let cell = 0; cell < map.cellCount; cell++) if (isLand(map, cell)) order.push(cell);
  order.sort((a, b) => height(b) - height(a) || a - b);
  const parent = new Int32Array(map.cellCount).fill(-1),
    find = (cell: number): number => {
      while (parent[cell] !== cell) cell = parent[cell] = parent[parent[cell]];
      return cell;
    },
    peaks = new Map<number, Peak>();
  for (const cell of order) {
    const tops = [
      ...new Set(
        map
          .neighbours(cell)
          .filter((n) => parent[n] >= 0)
          .map((n) => find(n))
      ),
    ].sort((a, b) => height(b) - height(a) || a - b);
    if (!tops.length) {
      parent[cell] = cell;
      peaks.set(cell, { cell, prominence: NaN, col: -1 });
      continue;
    }
    parent[cell] = tops[0];
    for (const top of tops.slice(1)) {
      peaks.set(top, { cell: top, prominence: height(top) - height(cell), col: cell });
      parent[top] = tops[0];
    }
  }
  for (const peak of peaks.values())
    if (peak.col < 0) peak.prominence = height(peak.cell) - seaLevel(map, peak.cell);
  return [...peaks.values()];
}
const seaLevel = (map: PoiMap, cell: number) =>
  map.has("seaLevel") ? map.read("seaLevel", cell) : 0;
