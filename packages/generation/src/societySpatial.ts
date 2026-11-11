import {
  gridPosition,
  fieldChartFootprint,
  MapScale,
  gridDistance,
  overlappingAdaptiveLeaves,
  CellList,
  neighbors,
  spatial,
  type Grid,
  type Bounds,
  type Position,
} from "@atlas/domain";
import type { GenerationState } from "./process";

/** Immutable geometry during one society era; water and livelihood values stay live. */
export class SocietyNeighbors {
  private readonly starts: Int32Array;
  private readonly counts: Int32Array;
  private readonly links = new CellList();
  private readonly covers: ReturnType<typeof spatial.geometryCoverage>;
  constructor(
    readonly grid: Grid,
    private readonly diagonal = true
  ) {
    this.starts = new Int32Array(grid.active.length).fill(-1);
    this.counts = new Int32Array(grid.active.length);
    this.covers = spatial.geometryCoverage(fieldChartFootprint(grid));
  }
  *at(i: number): Iterable<number> {
    if (this.starts[i] < 0) {
      const row = neighbors(this.grid, i, this.diagonal, this.covers);
      this.starts[i] = this.links.length;
      this.counts[i] = row.length;
      for (const j of row) this.links.push(j);
    }
    const start = this.starts[i],
      end = start + this.counts[i];
    for (let at = start; at < end; at++) yield this.links.at(at);
  }
}

/** Sharing stops with the cycle sequence; an authored refresh gets its own geometry read. */
export function coastalNeighbors(state: GenerationState): SocietyNeighbors {
  const work = state.society,
    previous = work?.coastalNeighbors;
  if (work?.cycle && previous?.grid === state.surface) return previous;
  const current = new SocietyNeighbors(state.surface);
  if (work?.cycle) work.coastalNeighbors = current;
  return current;
}

/** Query the existing sampling topology rather than scanning the world for each local work. */
export function* samplesInBox(grid: Grid, box: Bounds) {
  if (grid.topology) {
    for (const i of overlappingAdaptiveLeaves(grid.topology, box, true))
      if (grid.active.get(i)) yield i;
  } else {
    const [w, s, e, n] = grid.bounds;
    const dx = (e - w) / (grid.width - 1),
      dy = (n - s) / (grid.height - 1);
    for (
      let y = Math.max(0, Math.ceil((box[1] - s) / dy));
      y <= Math.min(grid.height - 1, Math.floor((box[3] - s) / dy));
      y++
    )
      for (
        let x = Math.max(0, Math.ceil((box[0] - w) / dx));
        x <= Math.min(grid.width - 1, Math.floor((box[2] - w) / dx));
        x++
      )
        if (grid.active.get(y * grid.width + x)) yield y * grid.width + x;
  }
}

/** The sample nearest a position on a state's surface. */
export function nearestSample(state: { surface: Grid }, p: Pick<Position, "x" | "y">) {
  return nearestSocietySample(state.surface, p);
}
export function nearestSocietySample(
  grid: Grid,
  p: Pick<Position, "x" | "y">,
  accepts: (i: number) => boolean = () => true
) {
  const [w, s, e, n] = grid.bounds;
  const extent = Math.max(
    Math.abs(p.x - w),
    Math.abs(p.x - e),
    Math.abs(p.y - s),
    Math.abs(p.y - n)
  );
  const scale = grid.scope.resolution
    ? MapScale.fromBounds(grid.bounds, grid.scope.resolution)
    : MapScale.fromCells(grid.bounds, Math.max(1, grid.active.length));
  let radius = scale.cells(1);
  for (;;) {
    let best = -1,
      distance = Infinity;
    for (const i of nearbySamples(grid, p, radius)) {
      if (!accepts(i)) continue;
      const q = gridPosition(grid, i),
        d = gridDistance(grid, p, q);
      if (d < distance) {
        best = i;
        distance = d;
      }
    }
    if (distance <= radius || radius >= extent) return best;
    radius *= 2;
  }
}
function* nearbySamples(grid: Grid, p: Pick<Position, "x" | "y">, radius: number) {
  const shifts = grid.periodicWidth ? [-grid.periodicWidth, 0, grid.periodicWidth] : [0];
  // A repeated sample across wrapped windows has the same distance and cannot
  // replace itself; avoid retaining a world-sized deduplication set.
  for (const shift of shifts)
    yield* samplesInBox(grid, [
      p.x + shift - radius,
      p.y - radius,
      p.x + shift + radius,
      p.y + radius,
    ]);
}
