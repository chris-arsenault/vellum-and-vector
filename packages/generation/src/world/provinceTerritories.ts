import { spatial, type Bounds } from "@atlas/domain";

interface Site {
  x: number;
  y: number;
}
export interface ProvinceTerritories {
  areas: Float64Array;
  adjacent: Uint8Array;
}
const images = (sites: Site[], width: number) =>
  (width ? [-width, 0, width] : [0]).flatMap((offset) =>
    sites.map((p) => ({ x: p.x + offset, y: p.y, z: 0 }))
  );
/** Periodic Voronoi neighbors are Delaunay edges on the chart and its two images. */
export function provinceAdjacency(sites: Site[], width: number): Uint8Array {
  const result = new Uint8Array(sites.length * sites.length);
  const start = width ? sites.length : 0,
    end = start + sites.length;
  for (const [a, b] of spatial.delaunayEdges(images(sites, width))) {
    if ((a < start || a >= end) && (b < start || b >= end)) continue;
    const i = a % sites.length,
      j = b % sites.length;
    if (i === j) continue;
    result[i * sites.length + j] = result[j * sites.length + i] = 1;
  }
  return result;
}
/** Each site's Voronoi cell area within the chart. On a cylinder the chart's two images bound
 * the cells, so a cell crossing the seam keeps its full periodic area. A repeated site holds
 * no area of its own; the first copy owns the cell. */
export function provinceAreas(sites: Site[], bounds: Bounds, width: number): Float64Array {
  const sources = images(sites, width),
    offset = width ? sites.length : 0;
  const cells = spatial.voronoiCells(sources, [
    bounds[0] - width,
    bounds[1],
    bounds[2] + width,
    bounds[3],
  ]);
  return Float64Array.from(sites, (site, i) => {
    const first = sites.findIndex((other) => other.x === site.x && other.y === site.y);
    const cell = cells[offset + i];
    return first === i && cell ? spatial.area(cell) : 0;
  });
}
export function provinceTerritories(
  sites: Site[],
  bounds: Bounds,
  width: number
): ProvinceTerritories {
  return { areas: provinceAreas(sites, bounds, width), adjacent: provinceAdjacency(sites, width) };
}
