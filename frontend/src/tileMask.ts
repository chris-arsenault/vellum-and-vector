import type { Geometry, Position as Coordinate } from "geojson";

/** Polygon rings of a geometry; points and lines enclose nothing. */
function rings(geometry: Geometry): Coordinate[][] {
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(rings);
  return [];
}

/** Edges as flat [x0, y0, x1, y1] runs, keeping those that reach the tile's rows. */
function edges(geometry: Geometry, low: number, high: number) {
  const kept: number[] = [];
  for (const ring of rings(geometry))
    for (let k = 1; k < ring.length; k++) {
      const [ax, ay] = ring[k - 1],
        [bx, by] = ring[k];
      if (Math.max(ay, by) < low || Math.min(ay, by) > high) continue;
      kept.push(ax, ay, bx, by);
    }
  return kept;
}

/** Crossings of one row's centre line, sorted west to east. */
function crossings(run: number[], y: number, into: number[]) {
  into.length = 0;
  for (let k = 0; k < run.length; k += 4) {
    const ay = run[k + 1],
      by = run[k + 3];
    if (ay > y === by > y) continue;
    const ax = run[k];
    into.push(ax + ((y - ay) * (run[k + 2] - ax)) / (by - ay));
  }
  return into.sort((a, b) => a - b);
}

/** Whether every edge lies wholly west or wholly east of the tile: a shape there covers none of it. */
function westOrEast(run: number[], extent: number[]) {
  let low = Infinity,
    high = -Infinity;
  for (let k = 0; k < run.length; k += 2) {
    low = Math.min(low, run[k]);
    high = Math.max(high, run[k]);
  }
  return high < extent[0] || low > extent[2];
}

/** Crossings strictly west of x, by bisection. */
function westOf(sorted: number[], x: number) {
  let low = 0,
    high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < x) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Even-odd membership of each pixel centre of a tile in a polygonal geometry, from one pass
 * over the edges per row instead of a point query per pixel. Pixel centres follow the tile
 * sampler: column c at x0 + (c + 0.5)dx, row r at y1 - (r + 0.5)dy. `fold` maps a sample's x
 * into the geometry's chart on a cylindrical world. Each covered pixel is handed to `mark`.
 */
export function scanTile(
  geometry: Geometry,
  extent: number[],
  size: number,
  mark: (pixel: number) => void,
  fold?: (x: number) => number
) {
  const folded = fold !== undefined;
  fold ??= (x) => x;
  const dx = (extent[2] - extent[0]) / size,
    dy = (extent[3] - extent[1]) / size;
  const run = edges(geometry, extent[1], extent[3]);
  if (!run.length || (!folded && westOrEast(run, extent))) return;
  const row: number[] = [];
  for (let r = 0; r < size; r++) {
    const sorted = crossings(run, extent[3] - (r + 0.5) * dy, row);
    if (!sorted.length) continue;
    for (let c = 0; c < size; c++)
      if (westOf(sorted, fold(extent[0] + (c + 0.5) * dx)) % 2) mark(r * size + c);
  }
}

/** A tile's pixels covered by a polygonal geometry, 1 inside and 0 outside. */
export function polygonTileMask(
  geometry: Geometry,
  extent: number[],
  size: number,
  fold?: (x: number) => number
) {
  const mask = new Uint8Array(size * size);
  scanTile(geometry, extent, size, (pixel) => (mask[pixel] = 1), fold);
  return mask;
}
