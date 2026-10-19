// OceanCurrentLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, toUnits, truncate } from "./math";
import { unitNoise } from "./noise";
import { prepareMetricSmoother } from "./metricSmoothing";
import { physicalDistance, physicalGradients, physicalFace } from "./physicalMetric";

function normalized(x: number, y: number): [number, number] {
  const length = Math.sqrt(x * x + y * y);
  return length < 0.000001 ? [0, 0] : [round((x / length) * 1000), round((y / length) * 1000)];
}
function basinInfluence(map: PhysicalField, i: number): [number, number] {
  let x = 0,
    y = 0;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const offset = i * map.mesh.stride + edge,
      j = map.mesh.neighbors[offset];
    if (j < 0) continue;
    const face = physicalFace(map.mesh, i, edge);
    const support = face.length / (2 * (map.mesh.cellWidth[i] + map.mesh.cellHeight[i]));
    const dx = face.nx * support * 4,
      dy = face.ny * support * 4;
    if (map.WaterKindCodes[j] !== 1) {
      x -= dx * 1.4;
      y -= dy * 1.4;
      continue;
    }
    const gain = clamp(
      (map.WaterDepths[j] - map.WaterDepths[i]) / (1024 * map.mesh.edgeLength[offset] * 0.024),
      -1,
      1
    );
    x += dx * gain;
    y += dy * gain;
  }
  return [x, y];
}
function seedDirections(map: PhysicalField, c: PhysicalContext) {
  const scale = Math.max(180_000, map.mesh.contentRadius * 0.46);
  const potential = Float64Array.from({ length: map.mesh.count }, (_, i) =>
    unitNoise(map.mesh.x[i], map.mesh.y[i], c.Seed, scale, 3)
  );
  const gradient = physicalGradients(map.mesh, potential);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    const gx = gradient.x[i] * 10_000,
      gy = gradient.y[i] * 10_000;
    const x = map.mesh.x[i],
      y = map.mesh.y[i],
      f = Math.fround;
    const radius = Math.max(1, Math.sqrt(f(f(x * x) + f(y * y))));
    const sign = potential[i] >= 0.5 ? 1 : -1,
      [bx, by] = basinInfluence(map, i);
    [map.OceanCurrentX[i], map.OceanCurrentY[i]] = normalized(
      gy * 3.4 + (-y / radius) * sign * 0.48 + bx * 0.88,
      -gx * 3.4 + (x / radius) * sign * 0.48 + by * 0.88
    );
  }
}
function smoothDirections(map: PhysicalField, length: number) {
  const ocean = Uint8Array.from(map.WaterKindCodes, (kind) => Number(kind === 1));
  const smooth = prepareMetricSmoother(map.mesh, length, ocean);
  const x = smooth(Float64Array.from(map.OceanCurrentX));
  const y = smooth(Float64Array.from(map.OceanCurrentY));
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] === 1)
      [map.OceanCurrentX[i], map.OceanCurrentY[i]] = normalized(x[i], y[i]);
}
function upstreamNeighbors(map: PhysicalField): Int32Array {
  const targets = new Int32Array(map.mesh.count).fill(-1);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    let best = 0;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const offset = i * map.mesh.stride + edge,
        j = map.mesh.neighbors[offset];
      if (j < 0 || map.WaterKindCodes[j] !== 1) continue;
      const f = Math.fround;
      const score = f(
        f(map.mesh.edgeX[offset] * -map.OceanCurrentX[i]) +
          f(map.mesh.edgeY[offset] * -map.OceanCurrentY[i])
      );
      if (score > best) {
        best = score;
        targets[i] = j;
      }
    }
  }
  return targets;
}
function measureStrength(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    const depth = clamp(
      truncate((toUnits(map.WaterDepths[i]) * 420) / c.Profile.ShelfBreakDepth),
      0,
      420
    );
    const broad = round(
      unitNoise(
        map.mesh.x[i],
        map.mesh.y[i],
        c.Seed ^ 0x19af,
        Math.max(200_000, map.mesh.contentRadius * 0.38),
        2
      ) * 250
    );
    map.OceanCurrentStrength[i] = clamp(
      c.Profile.OceanCurrentMinimumStrength + depth + broad,
      1,
      1000
    );
  }
}
function heatSources(map: PhysicalField): Int32Array {
  const source = new Int32Array(map.mesh.count);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    let heat = map.Geothermal[i];
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j >= 0) heat = Math.max(heat, truncate((map.Geothermal[j] * 4) / 5));
    }
    source[i] = clamp(60 + truncate((heat * 4) / 5), 0, 1000);
    map.OceanCurrentHeat[i] = source[i];
  }
  return source;
}
function upstreamHeat(
  map: PhysicalField,
  source: Int32Array,
  targets: Int32Array,
  start: number,
  reach: number,
  cooling: number
) {
  let current = start,
    traveled = 0,
    heat = source[start];
  const visited = new Set([start]);
  while (traveled < reach) {
    const next = targets[current];
    if (next < 0 || visited.has(next)) break;
    const segment = physicalDistance(map.mesh, current, next);
    const distance = Math.min(segment, reach - traveled);
    const mixed = source[current] + ((source[next] - source[current]) * distance) / segment;
    traveled += distance;
    heat = Math.max(heat, mixed - (cooling * traveled) / reach);
    current = next;
    visited.add(next);
  }
  return heat;
}
/** Characteristic upwind interpolation, source floors and cooling over physical travel. */
export function transportOceanHeat(
  map: PhysicalField,
  reach: number,
  cooling: number,
  targets: Int32Array
) {
  const source = heatSources(map);
  if (reach <= 0) return;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] === 1)
      map.OceanCurrentHeat[i] = round(upstreamHeat(map, source, targets, i, reach, cooling));
}
function waveExposure(map: PhysicalField, steps: number, targets: Int32Array) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    let fetch = 0,
      current = i,
      previous = -1;
    const visited = new Set([i]);
    while (fetch < steps) {
      const next = targets[current];
      if (next < 0 || next === previous || visited.has(next)) break;
      visited.add(next);
      fetch += physicalDistance(map.mesh, current, next);
      previous = current;
      current = next;
    }
    map.WaveExposure[i] = clamp(
      truncate((fetch * 760) / steps) + truncate((map.OceanCurrentStrength[i] * 240) / 1000),
      0,
      1000
    );
  }
}
export function oceanCurrents(map: PhysicalField, c: PhysicalContext) {
  for (const name of [
    "OceanCurrentX",
    "OceanCurrentY",
    "OceanCurrentStrength",
    "OceanCurrentHeat",
    "WaveExposure",
  ] as const)
    map[name].fill(0);
  seedDirections(map, c);
  smoothDirections(map, c.Profile.OceanCurrentSmoothingLength);
  measureStrength(map, c);
  const upstream = upstreamNeighbors(map);
  transportOceanHeat(
    map,
    c.Profile.OceanCurrentHeatDistance,
    c.Profile.OceanCurrentHeatCooling,
    upstream
  );
  waveExposure(map, c.Profile.OceanCurrentFetchDistance, upstream);
}
