import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import { hashUnit } from "./noise";
import { traceOceanBeam } from "./magicBeams";
import { nearestTriangle } from "./mesh";
import { worldCandidates } from "./worldSources";
import { CellList, FloatList, KeyedHeap, radixOrder, type Band } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";
import { areaBudget, mediumArea, referenceOceanArea, referenceCoastLength } from "./worldScale";

function coastlineLength(map: PhysicalField) {
  let length = 0;
  const mesh = map.mesh;
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) !== 1 || map.WaterKindCodes.get(i) !== 1) continue;
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j >= 0 && map.WaterKindCodes.get(j) !== 1) length += mesh.faceLength(i, edge);
    }
  }
  return length;
}

function coastalCell(map: PhysicalField, i: number) {
  if (map.WaterKindCodes.get(i) !== 1) return false;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.WaterKindCodes.get(j) !== 1) return true;
  }
  return false;
}
/** Every content coast cell starts half its own width from the shore. */
function seedCoast(map: PhysicalField, distances: Band, queue: KeyedHeap) {
  const { mesh } = map;
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) !== 1 || !coastalCell(map, i)) continue;
    const start = Math.min(mesh.cellWidth(i), mesh.cellHeight(i)) / 2;
    distances.set(i, start);
    queue.push(i, start);
  }
}
function coastDistances(map: PhysicalField, reach: number) {
  const { mesh } = map;
  const distances = workingArray(map, "float64", "magic:coast-distance").fill(Infinity);
  const queue = new KeyedHeap("min");
  seedCoast(map, distances, queue);
  for (let i = queue.pop(); i >= 0; i = queue.pop()) {
    const distance = queue.poppedKey();
    if (distance !== distances.get(i)) continue;
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge),
        next = distance + mesh.edgeLength(i, edge);
      if (j < 0 || map.WaterKindCodes.get(j) !== 1 || next > reach || next >= distances.get(j))
        continue;
      distances.set(j, next);
      queue.push(j, next);
    }
  }
  return distances;
}
function oceanCandidates(
  map: PhysicalField,
  count: number,
  seed: number,
  coastalDistance?: number
) {
  const distances = coastalDistance === undefined ? null : coastDistances(map, coastalDistance);
  const cells = new CellList(),
    priorities = new FloatList();
  for (const source of worldCandidates(map.mesh, seed, Math.max(256, count * 16))) {
    const i = nearestTriangle(map.mesh, source.x, source.y);
    if (i < 0 || map.mesh.membership(i) !== 1 || map.WaterKindCodes.get(i) !== 1) continue;
    if (distances && distances.get(i) > coastalDistance!) continue;
    cells.push(i);
    priorities.push(source.priority);
  }
  if (distances) releaseWorking(map, distances);
  return { cells, priorities: priorities.finish() };
}
function oceanSources(map: PhysicalField, count: number, seed: number, coastalDistance?: number) {
  if (count === 0) return [];
  const { cells, priorities } = oceanCandidates(map, count, seed, coastalDistance);
  // Highest priority first; a cell reached by several candidates is taken once.
  const taken = workingArray(map, "uint8", "magic:ocean-sources"),
    selected: number[] = [];
  for (const k of radixOrder(priorities, true)) {
    const i = cells.at(k);
    if (taken.get(i) || selected.length >= count) continue;
    taken.set(i, 1);
    selected.push(i);
  }
  releaseWorking(map, taken);
  return selected;
}
export function oceanPropagation(
  state: GenerationState,
  field: MagicField,
  seed: number,
  activity = 1
) {
  const map = state.physical!.map,
    p = field.definition.parameters;
  for (let i = 0; i < map.mesh.count; i++) {
    const source = field.source.get(i);
    if (map.mesh.membership(i) !== 1 || !source || map.WaterKindCodes.get(i) !== 1) continue;
    for (let ray = 0; ray < p.rayCount; ray++)
      traceOceanBeam(
        map,
        field,
        seed ^ ray,
        i,
        (ray * Math.PI * 2) / p.rayCount,
        Math.round(source * activity),
        p.rayDistance
      );
  }
  for (const [index, i] of oceanSources(
    map,
    areaBudget(p.coastalSources, coastlineLength(map), referenceCoastLength),
    seed,
    p.coastalSourceDistance
  ).entries()) {
    field.rogue.set(i, 1);
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
  const wakes = areaBudget(
    p.wakeSources,
    mediumArea(map, (i) => map.WaterKindCodes.get(i) === 1),
    referenceOceanArea
  );
  for (const [index, i] of oceanSources(map, wakes, seed ^ 0x3359).entries())
    traceOceanBeam(
      map,
      field,
      seed ^ Math.imul(index, 7919),
      i,
      hashUnit(seed ^ Math.imul(index, 7919), Math.round(map.mesh.x(i) / 10_000), 0) * Math.PI * 2,
      p.wakeStrength * activity,
      p.wakeDistance,
      true
    );
}
