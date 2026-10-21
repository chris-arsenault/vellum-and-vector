import type { PhysicalField } from "./field";
import { PriorityQueue } from "./priorityQueue";
import { windStrength } from "./ecologyEnvironment";

export type Carrier = "wind" | "current";
export interface Crossing {
  carrier: Carrier;
  /** Effective over-water distance, in metres, at which arrival waits e-fold. */
  reach: number;
  /** Expected years for a crossing of negligible length. */
  interval: number;
}
const sea = (map: PhysicalField, i: number) => map.WaterKindCodes[i] === 1;

/** How much the carrier speeds travel along an edge; never below a fifth. */
function carried(map: PhysicalField, carrier: Carrier, i: number, edge: number) {
  const at = i * map.mesh.stride + edge;
  const [x, y, strength] =
    carrier === "wind"
      ? [map.WindX[i], map.WindY[i], windStrength(map, i)]
      : [map.OceanCurrentX[i], map.OceanCurrentY[i], (2 * map.OceanCurrentStrength[i]) / 1000];
  const alignment = (map.mesh.edgeX[at] * x + map.mesh.edgeY[at] * y) / 1000;
  return Math.max(0.2, 1 + alignment * strength);
}
/** Carrier-weighted length of an edge touching the sea; land-to-land edges cost nothing. */
function waterStep(map: PhysicalField, carrier: Carrier, i: number, edge: number, j: number) {
  if (!sea(map, i) && !sea(map, j)) return 0;
  return map.mesh.edgeLength[i * map.mesh.stride + edge] / carried(map, carrier, i, edge);
}
/**
 * Effective over-water distance from occupied land to land reachable only by
 * crossing the sea; Infinity elsewhere. Land relays at no further cost, so
 * islands act as stepping stones; land joined to a source without crossing
 * water keeps zero and is left to the existing overland fronts.
 */
export function waterDistance(
  map: PhysicalField,
  occupied: (i: number) => boolean,
  carrier: Carrier,
  limit: number
) {
  const mesh = map.mesh,
    distance = new Float64Array(mesh.count).fill(Infinity);
  const queue = new PriorityQueue<{ i: number; d: number }>((a, b) => a.d - b.d || a.i - b.i);
  for (let i = 0; i < mesh.count; i++)
    if (!sea(map, i) && occupied(i)) {
      distance[i] = 0;
      queue.push({ i, d: 0 });
    }
  while (queue.count) {
    const { i, d } = queue.pop();
    if (d !== distance[i]) continue;
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const j = mesh.neighbors[i * mesh.stride + edge];
      if (j < 0) continue;
      const next = d + waterStep(map, carrier, i, edge, j);
      if (next > limit || next >= distance[j]) continue;
      distance[j] = next;
      queue.push({ i: j, d: next });
    }
  }
  return Float64Array.from(distance, (d, i) => (sea(map, i) || d === 0 ? Infinity : d));
}
/** Expected arrival in years after a crossing of the given effective distance. */
export const crossingTime = (crossing: Crossing, distance: number) =>
  crossing.interval * Math.exp(distance / crossing.reach);
