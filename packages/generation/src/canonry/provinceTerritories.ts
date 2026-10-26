import { spatial } from "@atlas/domain";

interface Site {
  x: number;
  y: number;
}
export interface ProvinceTerritories {
  areas: Float64Array;
  adjacent: Uint8Array;
}
/** Periodic Voronoi neighbors are Delaunay edges on the chart and its two images. */
function adjacency(sites: Site[], width: number): Uint8Array {
  const offsets = width ? [-width, 0, width] : [0];
  const images = offsets.flatMap((offset) => sites.map((p) => ({ x: p.x + offset, y: p.y, z: 0 })));
  const result = new Uint8Array(sites.length * sites.length);
  const start = width ? sites.length : 0,
    end = start + sites.length;
  for (const [a, b] of spatial.delaunayEdges(images)) {
    if ((a < start || a >= end) && (b < start || b >= end)) continue;
    const i = a % sites.length,
      j = b % sites.length;
    if (i === j) continue;
    result[i * sites.length + j] = result[j * sites.length + i] = 1;
  }
  return result;
}
export function provinceTerritories(
  sites: Site[],
  samples: Site[],
  width: number
): ProvinceTerritories {
  const areas = new Float64Array(sites.length);
  // Equal-area world-space samples keep growth budgets independent of terrain sampling.
  for (const sample of samples) {
    let nearest = 0,
      minimum = Infinity;
    for (const [i, site] of sites.entries()) {
      const dx = site.x - sample.x;
      const distance =
        (width ? dx - Math.round(dx / width) * width : dx) ** 2 + (site.y - sample.y) ** 2;
      if (distance < minimum) {
        nearest = i;
        minimum = distance;
      }
    }
    areas[nearest]++;
  }
  return { areas, adjacent: adjacency(sites, width) };
}
