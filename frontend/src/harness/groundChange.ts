import { MapScale } from "@atlas/domain";
import type { PhysicalField } from "../../../packages/generation/src/world/field";

/**
 * What each process does to the height of low land, read between one look at the map and the
 * next: how many cells it moved, by how much, how unevenly from one cell to its neighbours,
 * and whether it moved the cells that gather little water as much as those that gather much.
 * It names the process that roughens ground, and says on which cells.
 */
const lowland = 300;
const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.floor(q * (sorted.length - 1))] * 10) / 10 : 0;
};
const mean = (values: number[]) =>
  values.length
    ? Math.round((10 * values.reduce((sum, value) => sum + value, 0)) / values.length) / 10
    : 0;

export function groundChangeWatch() {
  let before: Float64Array | undefined;
  const changes: object[] = [];
  return {
    changes,
    look(process: string, map: PhysicalField) {
      const heights = Float64Array.from({ length: map.mesh.count }, (_, cell) =>
        MapScale.metres(map.Elevation.get(cell), "native")
      );
      if (before) {
        const change = describe(map, before, heights);
        if (change.cellsMoved > 0) changes.push({ process, ...change });
      }
      before = heights;
      return changes;
    },
  };
}
function describe(map: PhysicalField, before: Float64Array, after: Float64Array) {
  const mesh = map.mesh,
    low = (cell: number) =>
      mesh.membership(cell) === 1 &&
      map.WaterKindCodes.get(cell) === 0 &&
      after[cell] - MapScale.metres(map.EffectiveSeaLevel, "native") <= lowland,
    moved: number[] = [],
    uneven: number[] = [],
    few: number[] = [],
    many: number[] = [];
  let cells = 0;
  for (let cell = 0; cell < mesh.count; cell++) {
    if (!low(cell)) continue;
    cells++;
    const change = after[cell] - before[cell];
    if (Math.abs(change) > 0.01) moved.push(change);
    let most = 0;
    for (let edge = 0; edge < mesh.degree(cell); edge++) {
      const next = mesh.neighbor(cell, edge);
      if (next >= 0 && low(next))
        most = Math.max(most, Math.abs(change - (after[next] - before[next])));
    }
    uneven.push(most);
    const gathers = map.CatchmentArea.get(cell) / mesh.area(cell);
    if (gathers <= 3) few.push(change);
    else if (gathers >= 30) many.push(change);
  }
  return {
    cellsMoved: cells ? Math.round((1000 * moved.length) / cells) / 1000 : 0,
    movedMetres: [quantile(moved, 0.1), quantile(moved, 0.5), quantile(moved, 0.9)],
    unevenToNeighbourMetres: [quantile(uneven, 0.5), quantile(uneven, 0.9)],
    meanWhereFewCellsDrain: mean(few),
    meanWhereManyCellsDrain: mean(many),
  };
}
