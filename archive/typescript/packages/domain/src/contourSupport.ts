import type { AdaptiveTopology } from "./adaptiveTopology";
import type { RegularGrid } from "./grids";

/**
 * Bilinear values and class memberships cannot cross inside a uniform quad. Read
 * membership once per station and trace only transitions and the selected outer edge.
 * Include interiors when membership is only a mask for another varying scalar (lakes).
 */
export function* regularContourSupport(
  grid: RegularGrid,
  inside: (sample: number) => boolean,
  includeInterior = false
) {
  const width = grid.width;
  let lower = new Uint8Array(width),
    upper = new Uint8Array(width);
  for (let x = 0; x < width; x++) lower[x] = Number(inside(x));
  for (let y = 0; y < grid.height - 1; y++) {
    for (let x = 0; x < width; x++) upper[x] = Number(inside((y + 1) * width + x));
    for (let x = 0; x < width - 1; x++) {
      const count = lower[x] + lower[x + 1] + upper[x] + upper[x + 1];
      if (!count) continue;
      const boundary = outerCell(x, y, width, grid.height);
      if (count !== 4 || includeInterior || boundary) yield y * width + x;
    }
    [lower, upper] = [upper, lower];
  }
}
function outerCell(x: number, y: number, width: number, height: number) {
  return x === 0 || y === 0 || x === width - 2 || y === height - 2;
}

/** Reconstruction uses incident-cell gradients; retain the complete three-face stencil. */
export function* contourSupport(topology: AdaptiveTopology, members: Iterable<number>) {
  const count = topology.leaves.length,
    coverage = topology.coverage;
  const selected = coverage.scratch("uint8", "contour:adaptive-membership", count);
  const queue = coverage.scratch("int32", "contour:adaptive-support", count);
  let end = 0;
  const add = (cell: number) => {
    if (!selected.get(cell)) {
      selected.set(cell, 1);
      queue.set(end++, cell);
    }
  };
  try {
    for (const member of members) add(member);
    let start = 0;
    for (let ring = 0; ring < 3; ring++) {
      const stop = end;
      for (let index = start; index < stop; index++) {
        const cell = queue.get(index);
        for (let at = topology.offsets.get(cell); at < topology.offsets.get(cell + 1); at++)
          add(topology.neighbors.get(at));
      }
      start = stop;
    }
    for (let i = 0; i < end; i++) yield queue.get(i);
  } finally {
    coverage.release(selected);
    coverage.release(queue);
  }
}
