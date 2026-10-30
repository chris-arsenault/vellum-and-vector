import {
  fieldInterpolator,
  fieldPosition,
  spatial,
  type AdaptivePointLocator,
  type GridSurface,
  type Position,
  type RegularGrid,
} from "@atlas/domain";

// Uniform-grid PCHIP: harmonic-mean tangents vanish at extrema and retain
// monotone segments without the slope jumps of bilinear interpolation.
function tangent(a: number, b: number) {
  return a * b > 0 ? (2 * a * b) / (a + b) : 0;
}
function cubic(values: number[], t: number, first: boolean, last: boolean) {
  const [a, b, c, d] = values,
    delta = c - b;
  const left = first ? delta : tangent(b - a, delta),
    right = last ? delta : tangent(delta, d - c);
  return b + t * (left + t * (3 * delta - 2 * left - right + t * (left + right - 2 * delta)));
}

function regularDisplay(grid: RegularGrid, fallback: (p: Position) => number) {
  const { bounds, width, height } = grid,
    read = displayCell(grid);
  return (p: Position) => {
    const x = Math.max(
        0,
        Math.min(width - 1, ((p.x - bounds[0]) / (bounds[2] - bounds[0])) * (width - 1))
      ),
      y = Math.max(
        0,
        Math.min(height - 1, ((p.y - bounds[1]) / (bounds[3] - bounds[1])) * (height - 1))
      );
    const col = Math.min(width - 2, Math.floor(x)),
      row = Math.min(height - 2, Math.floor(y));
    const samples = read(col, row);
    if (!samples) return fallback(p);
    const rows = samples.map((values) => cubic(values, x - col, col === 0, col === width - 2));
    return cubic(rows, y - row, row === 0, row === height - 2);
  };
}
/** A display polynomial reuses its sixteen source samples while pixels remain in that cell. */
function displayCell(grid: RegularGrid) {
  const { active, width, height } = grid,
    values = grid.channels.elevation;
  let previous = -1,
    held: number[][] | null = null;
  return (col: number, row: number) => {
    const cell = row * width + col;
    if (cell === previous && values.schema.immutable && active.schema.immutable) return held;
    previous = cell;
    held = [];
    for (let j = row - 1; j <= row + 2; j++) {
      const samples: number[] = [];
      for (let i = col - 1; i <= col + 2; i++) {
        const at =
          Math.max(0, Math.min(height - 1, j)) * width + Math.max(0, Math.min(width - 1, i));
        const value = values.get(at);
        if (!active.get(at) || !Number.isFinite(value)) return (held = null);
        samples.push(value);
      }
      held.push(samples);
    }
    return held;
  };
}

/**
 * Display-only elevation for contours and relief. Physical queries, water and
 * surface classes retain their shared domain samplers. Interpolation passes
 * through the original samples, stays bounded and never crosses overlay owners.
 * Adaptive fields already supply smooth patches through the domain sampler.
 */
export function terrainDisplaySampler(grid: GridSurface, locate?: AdaptivePointLocator) {
  const fallback = fieldInterpolator(grid, "elevation", false, locate);
  const base = grid.topology ? fallback : regularDisplay(grid, fallback);
  const overlays = (grid.overlays ?? [])
    .slice()
    .reverse()
    .filter((overlay) => overlay.channels.includes("elevation"))
    .map(({ grid }) => ({
      covers: spatial.pointCoverage(grid.scope.footprint),
      at: terrainDisplaySampler(grid, locate),
    }));
  return (p: Position): number => {
    const overlay = overlays.find((overlay) => overlay.covers(p));
    return overlay ? overlay.at(p) : base(fieldPosition(grid, p));
  };
}
