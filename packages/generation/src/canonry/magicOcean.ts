import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import { hashUnit, hashSigned } from "./noise";
import { nearestTriangle } from "./mesh";
import { worldCandidates } from "./worldSources";
import { PriorityQueue } from "./priorityQueue";

function paintBeam(
  map: PhysicalField,
  field: MagicField,
  source: number,
  amount: number,
  membership?: Float64Array
) {
  const radius = field.definition.parameters.beamWidth / 2;
  const cells = [source],
    visited = new Set(cells),
    weights: number[] = [];
  let total = 0;
  for (let head = 0; head < cells.length; head++) {
    const i = cells[head],
      distance = Math.hypot(map.mesh.x[i] - map.mesh.x[source], map.mesh.y[i] - map.mesh.y[source]);
    const weight = i === source ? 1 : Math.max(0, 1 - distance / radius);
    weights.push(weight);
    total += weight * map.mesh.areas[i];
    if (weight <= 0) continue;
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j >= 0 && !visited.has(j) && map.WaterKindCodes[j] === 1) {
        visited.add(j);
        cells.push(j);
      }
    }
  }
  const volume = amount * field.definition.parameters.beamWidth * map.mesh.spacing;
  cells.forEach((i, index) => {
    field.intensity[i] = Math.min(1000, field.intensity[i] + (volume * weights[index]) / total);
    if (membership && weights[index] > 0) membership[i] = 1;
  });
}

function oceanNeighbor(map: PhysicalField, current: number, previous: number, angle: number) {
  let next = -1,
    alignment = -0.15;
  for (let edge = 0; edge < 3; edge++) {
    const j = map.mesh.neighbors[current * 3 + edge];
    if (j < 0 || j === previous || map.WaterKindCodes[j] !== 1) continue;
    const score =
      Math.cos(angle) * map.mesh.edgeX[current * 3 + edge] +
      Math.sin(angle) * map.mesh.edgeY[current * 3 + edge];
    if (score > alignment) {
      next = j;
      alignment = score;
    }
  }
  return next;
}
function traceRay(
  map: PhysicalField,
  field: MagicField,
  seed: number,
  source: number,
  angle: number,
  energy: number,
  reach: number
) {
  let current = source,
    previous = -1,
    bounces = 0;
  for (let distance = 0; distance < reach && energy > 0; distance += map.mesh.spacing) {
    paintBeam(map, field, current, energy / 36);
    const next = oceanNeighbor(map, current, previous, angle);
    if (next < 0) {
      bounces++;
      if (bounces > 4) break;
      angle +=
        Math.PI * (0.58 + hashUnit(seed, Math.floor(map.mesh.x[current] / 10_000), bounces) * 0.62);
      previous = -1;
      energy -= 90;
      continue;
    }
    angle = Math.atan2(
      map.mesh.y[next] - map.mesh.y[current],
      map.mesh.x[next] - map.mesh.x[current]
    );
    previous = current;
    current = next;
    energy -= ((3 + 2 * bounces) * map.mesh.spacing) / 10_000;
  }
}
function coastalCell(map: PhysicalField, i: number) {
  return (
    map.WaterKindCodes[i] === 1 &&
    [0, 1, 2].some((edge) => {
      const j = map.mesh.neighbors[i * 3 + edge];
      return j >= 0 && map.WaterKindCodes[j] !== 1;
    })
  );
}
function coastDistances(map: PhysicalField, reach: number) {
  const { mesh } = map;
  const distances = new Float64Array(mesh.count).fill(Infinity);
  const queue = new PriorityQueue<{ i: number; distance: number }>(
    (a, b) => a.distance - b.distance
  );
  for (let i = 0; i < mesh.contentCount; i++) {
    if (!coastalCell(map, i)) continue;
    distances[i] = mesh.spacing / 2;
    queue.push({ i, distance: distances[i] });
  }
  while (queue.count) {
    const { i, distance } = queue.pop();
    if (distance !== distances[i]) continue;
    for (let edge = 0; edge < 3; edge++) {
      const j = mesh.neighbors[i * 3 + edge],
        next = distance + mesh.edgeLength[i * 3 + edge];
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
function traceWake(
  map: PhysicalField,
  field: MagicField,
  seed: number,
  source: number,
  activity: number
) {
  let current = source,
    previous = -1;
  let angle = hashUnit(seed, Math.round(map.mesh.x[source] / 10_000), 0) * Math.PI * 2;
  for (
    let distance = 0;
    distance < field.definition.parameters.wakeDistance;
    distance += map.mesh.spacing
  ) {
    paintBeam(map, field, current, 180 * activity, field.wake);
    const next = oceanNeighbor(map, current, previous, angle);
    if (next < 0) break;
    angle +=
      (hashSigned(seed, Math.floor(distance / 10_000), Math.floor(map.mesh.x[current] / 10_000)) *
        0.16 *
        map.mesh.spacing) /
      10_000;
    previous = current;
    current = next;
  }
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
      traceRay(
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
      traceRay(
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
    traceWake(map, field, seed ^ Math.imul(index, 7919), i, activity);
}
