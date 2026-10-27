import {
  gridPosition,
  gridCellBounds,
  neighbors,
  point,
  requireThat,
  spatial,
  type Grid,
  generateNumerical,
  type NumericalAllocator,
} from "@atlas/domain";
import { PriorityQueue } from "./canonry/priorityQueue";
import type { GenerationState, MapProcessContext } from "./process";

export const secondsPerYear = 365.25 * 24 * 60 * 60;

export function checkProgress(
  context: MapProcessContext,
  index: number,
  count: number,
  label: string
) {
  if (index % 128 !== 0) return;
  requireThat(!context.cancelled(), "generation_cancelled", "Generation was cancelled.");
  context.progress(index / Math.max(1, count), label);
}

export function adjacency(grid: Grid, diagonal = true) {
  return (i: number) => (grid.active[i] ? neighbors(grid, i, diagonal) : []);
}

export function cellDistance(grid: Grid, a: number, b: number): number {
  const from = gridPosition(grid, a),
    to = gridPosition(grid, b);
  return Math.hypot(from.x - to.x, from.y - to.y);
}

export function boundaryCell(grid: Grid, i: number): boolean {
  if (grid.topology) {
    const b = gridCellBounds(grid, i),
      t = grid.topology;
    return (
      b[0] <= grid.bounds[0] ||
      b[1] <= grid.bounds[1] ||
      b[2] >= grid.bounds[2] ||
      b[3] >= grid.bounds[3] ||
      Array.from(t.neighbors.subarray(t.offsets[i], t.offsets[i + 1])).some((j) => !grid.active[j])
    );
  }
  const x = i % grid.width,
    y = Math.floor(i / grid.width);
  return (
    x === 0 ||
    y === 0 ||
    x === grid.width - 1 ||
    y === grid.height - 1 ||
    [i - 1, i + 1, i - grid.width, i + grid.width].some((j) => !grid.active[j])
  );
}

// Authoring masks and inherited boundary cells stay fixed while surrounding
// material evolves. Their existing values remain the numerical interface.
export function movableTerrain(state: GenerationState) {
  const grid = state.surface,
    area = state.domain.world.areas[grid.scope.areaId];
  const patches = state.domain.fieldPatches.filter(
    (p) =>
      p.spaceId === grid.scope.spaceId &&
      p.channels.some((c) => ["elevation", "bedrock", "sediment"].includes(c))
  );
  const fixedFields = state.domain.world.fields.filter(
    (f) =>
      f.areaId === grid.scope.areaId &&
      (f.state === "protected" ||
        (f.state === "authored" && !patches.some((p) => p.fieldId === f.id))) &&
      (f.channels ?? [f.layerId]).some((c) => ["elevation", "bedrock", "sediment"].includes(c))
  );
  return generateNumerical(
    { type: "uint8", length: grid.active.length, lifetime: "process", name: "terrain:movable" },
    (i) => {
      const active = grid.active[i];
      if (!active || (area?.boundary && boundaryCell(grid, i))) return 0;
      const location = point(gridPosition(grid, i));
      return patches.some((p) => spatial.covers(p.footprint, location)) ||
        fixedFields.some((f) => spatial.covers(f.footprint ?? area.footprint, location))
        ? 0
        : 1;
    },
    state.numerical
  );
}

export function epochYears(context: MapProcessContext, fallback = 1): number {
  const years = context.epochs.at(-1)?.duration ?? fallback;
  requireThat(
    Number.isFinite(years) && years >= 0,
    "epoch_duration",
    "Elapsed years must be finite and nonnegative."
  );
  return years;
}

export function mixHash(x: number, y: number, seed: number): number {
  let value = Math.imul(x ^ seed, 374761393) ^ Math.imul(y, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const smooth = (v: number) => v * v * (3 - 2 * v);
  const tx = smooth(x - ix),
    ty = smooth(y - iy);
  const a = mixHash(ix, iy, seed) * (1 - tx) + mixHash(ix + 1, iy, seed) * tx;
  const b = mixHash(ix, iy + 1, seed) * (1 - tx) + mixHash(ix + 1, iy + 1, seed) * tx;
  return ((1 - ty) * a + ty * b) * 2 - 1;
}

export class CellHeap {
  private cells: PriorityQueue<{ cell: number }>;
  constructor(heights: ArrayLike<number>, numerical?: NumericalAllocator) {
    this.cells = new PriorityQueue(
      (a, b) => heights[a.cell] - heights[b.cell] || a.cell - b.cell,
      numerical,
      ["cell"]
    );
  }
  push(cell: number) {
    this.cells.push({ cell });
  }
  pop() {
    return this.cells.count ? this.cells.pop().cell : undefined;
  }
  close() {
    this.cells.close();
  }
}
