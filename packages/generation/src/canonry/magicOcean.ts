import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import { hashUnit } from "./noise";
import { traceOceanBeam } from "./magicBeams";
import { nearestTriangle } from "./mesh";
import { worldCandidates } from "./worldSources";
import { PriorityQueue } from "./priorityQueue";

function coastalCell(map: PhysicalField, i: number) {
  if (map.WaterKindCodes[i] !== 1) return false;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (j >= 0 && map.WaterKindCodes[j] !== 1) return true;
  }
  return false;
}
function coastDistances(map: PhysicalField, reach: number) {
  const { mesh } = map;
  const distances = new Float64Array(mesh.count).fill(Infinity);
  const queue = new PriorityQueue<{ i: number; distance: number }>(
    (a, b) => a.distance - b.distance
  );
  for (let i = 0; i < mesh.contentCount; i++) {
    if (!coastalCell(map, i)) continue;
    distances[i] = Math.min(mesh.cellWidth[i], mesh.cellHeight[i]) / 2;
    queue.push({ i, distance: distances[i] });
  }
  while (queue.count) {
    const { i, distance } = queue.pop();
    if (distance !== distances[i]) continue;
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const j = mesh.neighbors[i * mesh.stride + edge],
        next = distance + mesh.edgeLength[i * mesh.stride + edge];
      if (j < 0 || map.WaterKindCodes[j] !== 1 || next > reach || next >= distances[j]) continue;
      distances[j] = next;
      queue.push({ i: j, distance: next });
    }
  }
  return distances;
}
function oceanSources(map: PhysicalField, count: number, seed: number, coastalDistance?: number) {
  if (count === 0) return [];
  const distances = coastalDistance === undefined ? null : coastDistances(map, coastalDistance);
  const candidates: { i: number; priority: number }[] = [];
  for (const source of worldCandidates(map.mesh, seed, Math.max(256, count * 16))) {
    const i = nearestTriangle(map.mesh, source.x, source.y);
    if (i < 0 || i >= map.mesh.contentCount || map.WaterKindCodes[i] !== 1) continue;
    if (distances && distances[i] > coastalDistance!) continue;
    candidates.push({ i, priority: source.priority });
  }
  return [
    ...new Set(candidates.sort((a, b) => b.priority - a.priority).map((source) => source.i)),
  ].slice(0, count);
}
export function oceanPropagation(
  state: GenerationState,
  field: MagicField,
  seed: number,
  activity = 1
) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  for (let i = 0; i < map.mesh.contentCount; i++) {
    if (!field.source[i] || map.WaterKindCodes[i] !== 1) continue;
    for (let ray = 0; ray < p.rayCount; ray++)
      traceOceanBeam(
        map,
        field,
        seed ^ ray,
        i,
        (ray * Math.PI * 2) / p.rayCount,
        Math.round(field.source[i] * activity),
        p.rayDistance
      );
  }
  for (const [index, i] of oceanSources(
    map,
    p.coastalSources,
    seed,
    p.coastalSourceDistance
  ).entries()) {
    field.rogue[i] = 1;
    for (let ray = 0; ray < 24; ray++)
      traceOceanBeam(
        map,
        field,
        seed ^ Math.imul(index, 397) ^ ray,
        i,
        (ray * Math.PI * 2) / 24,
        Math.trunc(620 * activity),
        p.coastalRayDistance
      );
  }
  for (const [index, i] of oceanSources(map, p.wakeSources, seed ^ 0x3359).entries())
    traceOceanBeam(
      map,
      field,
      seed ^ Math.imul(index, 7919),
      i,
      hashUnit(seed ^ Math.imul(index, 7919), Math.round(map.mesh.x[i] / 10_000), 0) * Math.PI * 2,
      180 * activity,
      p.wakeDistance,
      true
    );
}
