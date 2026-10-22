// OceanCurrentLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, toUnits, truncate } from "./math";
import { unitNoise } from "./noise";
import { prepareMetricSmoother } from "./metricSmoothing";
import { physicalDistance } from "./physicalMetric";
import { gyreDirections, intensifyWesternBoundaries, seaSurfaceAnomaly } from "./oceanGyres";
import { linkDistance, wrapLinks } from "./longitudeWrap";

function normalized(x: number, y: number): [number, number] {
  const length = Math.sqrt(x * x + y * y);
  return length < 0.000001 ? [0, 0] : [round((x / length) * 1000), round((y / length) * 1000)];
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
  cooling: number,
  linkLength: (i: number, j: number) => number
) {
  let current = start,
    traveled = 0,
    heat = source[start];
  const visited = new Set([start]);
  while (traveled < reach) {
    const next = targets[current];
    if (next < 0 || visited.has(next)) break;
    const segment = linkLength(current, next);
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
  targets: Int32Array,
  linkLength = (i: number, j: number) => physicalDistance(map.mesh, i, j)
) {
  const source = heatSources(map);
  if (reach <= 0) return;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] === 1)
      map.OceanCurrentHeat[i] = round(
        upstreamHeat(map, source, targets, i, reach, cooling, linkLength)
      );
}
function waveExposure(
  map: PhysicalField,
  steps: number,
  targets: Int32Array,
  linkLength: (i: number, j: number) => number
) {
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
      fetch += linkLength(current, next);
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
  const western = gyreDirections(map, c);
  smoothDirections(map, c.Profile.OceanCurrentSmoothingLength);
  measureStrength(map, c);
  intensifyWesternBoundaries(map, c, western);
  const upstream = upstreamNeighbors(map);
  wrapLinks(map, c.Profile, upstream, (k) => map.WaterKindCodes[k] === 1);
  const linkLength = linkDistance(map, c.Profile);
  seaSurfaceAnomaly(map, c, upstream);
  transportOceanHeat(
    map,
    c.Profile.OceanCurrentHeatDistance,
    c.Profile.OceanCurrentHeatCooling,
    upstream,
    linkLength
  );
  waveExposure(map, c.Profile.OceanCurrentFetchDistance, upstream, linkLength);
}
