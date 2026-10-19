// OceanCurrentLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, toUnits, truncate } from "./math";
import { unitNoise } from "./noise";
import { smoothMetric } from "./metricSmoothing";

function normalized(x: number, y: number): [number, number] {
  const length = Math.sqrt(x * x + y * y);
  return length < 0.000001 ? [0, 0] : [round((x / length) * 1000), round((y / length) * 1000)];
}
function basinInfluence(map: PhysicalField, i: number): [number, number] {
  let x = 0,
    y = 0;
  for (let edge = 0; edge < 3; edge++) {
    const offset = i * 3 + edge,
      j = map.mesh.neighbors[offset];
    if (j < 0) continue;
    const dx = map.mesh.edgeX[offset],
      dy = map.mesh.edgeY[offset];
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
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    let gx = 0,
      gy = 0;
    for (let edge = 0; edge < 3; edge++) {
      const offset = i * 3 + edge,
        j = map.mesh.neighbors[offset];
      if (j < 0) continue;
      const difference = ((potential[j] - potential[i]) / map.mesh.edgeLength[offset]) * 10_000;
      gx += map.mesh.edgeX[offset] * difference;
      gy += map.mesh.edgeY[offset] * difference;
    }
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
  const x = smoothMetric(map.mesh, Float64Array.from(map.OceanCurrentX), length, ocean);
  const y = smoothMetric(map.mesh, Float64Array.from(map.OceanCurrentY), length, ocean);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] === 1)
      [map.OceanCurrentX[i], map.OceanCurrentY[i]] = normalized(x[i], y[i]);
}
function upstreamNeighbors(map: PhysicalField): Int32Array {
  const targets = new Int32Array(map.mesh.count).fill(-1);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    let best = 0;
    for (let edge = 0; edge < 3; edge++) {
      const offset = i * 3 + edge,
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
    for (let edge = 0; edge < 3; edge++) {
      const j = map.mesh.neighbors[i * 3 + edge];
      if (j >= 0) heat = Math.max(heat, truncate((map.Geothermal[j] * 4) / 5));
    }
    source[i] = clamp(60 + truncate((heat * 4) / 5), 0, 1000);
    map.OceanCurrentHeat[i] = source[i];
  }
  return source;
}
/** Upwind mixing and cooling over one configured physical transport interval. */
export function transportOceanHeat(
  map: PhysicalField,
  reach: number,
  cooling: number,
  targets: Int32Array
) {
  const source = heatSources(map);
  if (reach <= 0) return;
  const passes = Math.max(1, Math.ceil(reach / (map.mesh.spacing * 0.7))),
    fraction = reach / (passes * map.mesh.spacing),
    loss = cooling / passes;
  let current = Float64Array.from(source),
    next = current.slice();
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < map.mesh.count; i++) {
      if (map.WaterKindCodes[i] !== 1) continue;
      const upstream = targets[i] < 0 ? 0 : current[targets[i]];
      next[i] = Math.max(source[i], (1 - fraction) * current[i] + fraction * upstream - loss);
    }
    [current, next] = [next, current];
  }
  for (let i = 0; i < current.length; i++) map.OceanCurrentHeat[i] = round(current[i]);
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
      fetch += map.mesh.spacing;
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
