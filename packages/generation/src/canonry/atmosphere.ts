// AtmosphericFlow.cs and AtmosphericFlowLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, toUnits, truncate } from "./math";
import { fractalNoise, hashUnit } from "./noise";
import { physicalDistance } from "./physicalMetric";

export function alignedNeighbor(map: PhysicalField, i: number, dx: number, dy: number): number {
  let best = -1,
    score = -Number.MAX_VALUE;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const offset = i * map.mesh.stride + edge,
      j = map.mesh.neighbors[offset];
    if (j < 0) continue;
    const alignment = map.mesh.edgeX[offset] * dx + map.mesh.edgeY[offset] * dy;
    if (alignment > score) {
      best = j;
      score = alignment;
    }
  }
  return best;
}
function windDirection(map: PhysicalField, c: PhysicalContext, i: number): [number, number] {
  const p = c.Profile,
    span = Math.max(1, (map.mesh.contentRadius * 1.5) / Math.max(1, p.CirculationBands));
  const position = map.mesh.y[i] / span + hashUnit(c.Seed, 0x2a1, 0x7c9),
    band = Math.floor(position);
  const along = (band & 1) === 0 ? 1 : -1;
  const across = Math.cos((position - band) * Math.PI * 2) * (p.CirculationCellTurn / 1000);
  const wander =
    fractalNoise(
      map.mesh.x[i],
      map.mesh.y[i],
      c.Seed ^ 0x713b,
      Math.max(120_000, map.mesh.contentRadius * 0.28),
      3
    ) *
    (p.CirculationWander / 1000);
  const angle = Math.atan2(across, along) + wander;
  return [Math.cos(angle), Math.sin(angle)];
}
function traceAirMass(map: PhysicalField, scale: number, start: number) {
  let current = start,
    barrier = 0,
    moistureBarrier = -1,
    ocean = -1;
  const visited = new Set<number>();
  for (let distance = 0; distance < 180_000;) {
    const next = map.UpwindTargets[current];
    if (next < 0 || visited.has(next)) break;
    distance += physicalDistance(map.mesh, current, next);
    if (distance > 180_000) break;
    visited.add(next);
    current = next;
    barrier = Math.max(barrier, map.Elevation[current] - map.Elevation[start]);
    if (distance <= 140_000) moistureBarrier = barrier;
    if (map.WaterKindCodes[current] === 1) {
      ocean = current;
      break;
    }
  }
  const normalize = (value: number) =>
    clamp(truncate((toUnits(value) * 1000) / Math.max(1, truncate(scale / 2))), 0, 1000);
  map.MoistureBarriers[start] = normalize(moistureBarrier < 0 ? barrier : moistureBarrier);
  map.PrecipitationBarriers[start] = normalize(barrier);
  map.UpwindOceanSources[start] = ocean;
}
export function atmosphericFlow(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    const [x, y] = windDirection(map, c, i);
    map.WindX[i] = round(x * 1000);
    map.WindY[i] = round(y * 1000);
    map.UpwindTargets[i] = alignedNeighbor(map, i, -x, -y);
  }
  for (let i = 0; i < map.mesh.count; i++) traceAirMass(map, c.Profile.ElevationScale, i);
}
