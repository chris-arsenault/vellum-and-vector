import type { GenerationState } from "../process";
import type { PhysicalField } from "./field";
import type { MagicField } from "./magicState";
import { BoundedCandidates } from "./priorityQueue";
import { hashUnit, hashSigned } from "./noise";
import { triangleIdentity } from "./mesh";

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
  steps: number
) {
  let current = source,
    previous = -1,
    bounces = 0;
  for (let step = 0; step < steps && energy > 0; step++) {
    field.intensity[current] = Math.min(
      1000,
      field.intensity[current] + Math.max(1, Math.trunc(energy / 36))
    );
    const next = oceanNeighbor(map, current, previous, angle);
    if (next < 0) {
      bounces++;
      if (bounces > 4) break;
      angle += Math.PI * (0.58 + hashUnit(seed, current, bounces) * 0.62);
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
    energy -= 3 + 2 * bounces;
  }
}
function oceanSources(map: PhysicalField, count: number, seed: number, coastal: boolean) {
  if (count === 0) return [];
  const candidates = new BoundedCandidates(count);
  for (let i = 0; i < map.mesh.contentCount; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    if (
      coastal &&
      ![0, 1, 2].some((edge) => {
        const j = map.mesh.neighbors[i * 3 + edge];
        return j >= 0 && map.WaterKindCodes[j] !== 1;
      })
    )
      continue;
    candidates.consider(i, hashUnit(seed, triangleIdentity(map.mesh, i), count));
  }
  return candidates.bestIndexes();
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
  let angle = hashUnit(seed, source, 0) * Math.PI * 2;
  for (let step = 0; step < 190; step++) {
    field.wake[current] = 1;
    field.intensity[current] = Math.min(
      1000,
      field.intensity[current] + Math.trunc(180 * activity)
    );
    const next = oceanNeighbor(map, current, previous, angle);
    if (next < 0) break;
    angle += hashSigned(seed, step, current) * 0.16;
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
        p.raySteps
      );
  }
  for (const [index, i] of oceanSources(map, p.coastalSources, seed, true).entries()) {
    field.rogue[i] = 1;
    for (let ray = 0; ray < 24; ray++)
      traceRay(
        map,
        field,
        seed ^ Math.imul(index, 397) ^ ray,
        i,
        (ray * Math.PI * 2) / 24,
        Math.trunc(620 * activity),
        130
      );
  }
  for (const [index, i] of oceanSources(map, p.wakeSources, seed ^ 0x3359, false).entries())
    traceWake(map, field, seed ^ Math.imul(index, 7919), i, activity);
}
