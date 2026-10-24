import {
  gridPosition,
  visitAdaptiveOverlap,
  type Grid,
  type Bounds,
  type Position,
} from "@atlas/domain";

/** Query the existing sampling topology rather than scanning the world for each local work. */
export function samplesInBox(grid: Grid, box: Bounds) {
  const indices: number[] = [];
  if (grid.topology) visitAdaptiveOverlap(grid.topology, box, (i) => indices.push(i));
  else {
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
        indices.push(y * grid.width + x);
  }
  return indices.filter((i) => grid.active[i]).sort((a, b) => a - b);
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
  let radius = Math.max(1, grid.scope.resolution ?? Math.max(e - w, n - s) / 100);
  for (;;) {
    let best = -1,
      distance = Infinity;
    for (const i of samplesInBox(grid, [p.x - radius, p.y - radius, p.x + radius, p.y + radius])) {
      if (!accepts(i)) continue;
      const q = gridPosition(grid, i),
        d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < distance) {
        best = i;
        distance = d;
      }
    }
    if (distance <= radius || radius >= extent) return best;
    radius *= 2;
  }
}
