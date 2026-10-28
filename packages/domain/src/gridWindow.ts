import type { GridSurface } from "./grids";
import type { AdaptiveTopology } from "./adaptiveTopology";
import type { Bounds } from "./spatial";

/** Traverse only tree boxes touching a requested window; the stack is bounded by tree depth. */
export function* adaptiveWindowLeaves(topology: AdaptiveTopology, bounds: Bounds) {
  const stack = [0],
    boxes = topology.boxes;
  while (stack.length) {
    const node = stack.pop()!,
      at = node * 4;
    if (
      boxes.get(at) > bounds[2] ||
      boxes.get(at + 2) < bounds[0] ||
      boxes.get(at + 1) > bounds[3] ||
      boxes.get(at + 3) < bounds[1]
    )
      continue;
    const child = topology.children.get(node);
    if (child < 0) yield topology.leafIndex.get(node);
    else for (let offset = 3; offset >= 0; offset--) stack.push(child + offset);
  }
}
/** Candidate sample centres for statistics and point predicates, without scanning the whole field. */
export function* gridWindowCells(grid: GridSurface, bounds: Bounds) {
  if (grid.topology) {
    yield* adaptiveWindowLeaves(grid.topology, bounds);
    return;
  }
  const [x0, y0, x1, y1] = grid.bounds,
    dx = (x1 - x0) / (grid.width - 1),
    dy = (y1 - y0) / (grid.height - 1),
    left = Math.max(0, Math.floor((bounds[0] - x0) / dx)),
    right = Math.min(grid.width - 1, Math.ceil((bounds[2] - x0) / dx)),
    bottom = Math.max(0, Math.floor((bounds[1] - y0) / dy)),
    top = Math.min(grid.height - 1, Math.ceil((bounds[3] - y0) / dy));
  for (let y = bottom; y <= top; y++) for (let x = left; x <= right; x++) yield y * grid.width + x;
}
