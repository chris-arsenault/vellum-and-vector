import type { PhysicalField } from "./field";
import { windStrength } from "./ecologyEnvironment";
import { workingArray } from "./physicalNumerics";
import { KeyedHeap, type NumericalVector } from "@atlas/domain";

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
    distance = workingArray(map, "float64", "ecology:water-distance").fill(Infinity);
  const queue = new KeyedHeap("min");
  for (let i = 0; i < mesh.count; i++)
    if (!sea(map, i) && occupied(i)) {
      distance[i] = 0;
      queue.push(i, 0);
    }
  traverseWater(map, distance, queue, carrier, limit);
  for (let i = 0; i < distance.length; i++)
    if (sea(map, i) || distance[i] === 0) distance[i] = Infinity;
  return distance;
}
function traverseWater(
  map: PhysicalField,
  distance: NumericalVector,
  queue: KeyedHeap,
  carrier: Carrier,
  limit: number
) {
  const mesh = map.mesh;
  for (let i = queue.pop(); i >= 0; i = queue.pop()) {
    const d = queue.poppedKey();
    if (d !== distance[i]) continue;
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const j = mesh.neighbors[i * mesh.stride + edge];
      if (j < 0) continue;
      const next = d + waterStep(map, carrier, i, edge, j);
      if (next > limit || next >= distance[j]) continue;
      distance[j] = next;
      queue.push(j, next);
    }
  }
}
/** Expected arrival in years after a crossing of the given effective distance. */
export const crossingTime = (crossing: Crossing, distance: number) =>
  crossing.interval * Math.exp(distance / crossing.reach);
