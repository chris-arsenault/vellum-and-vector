// OceanCurrentLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, toUnits, truncate, units } from "./math";
import { unitNoise } from "./noise";

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
    const gain = clamp((map.WaterDepths[j] - map.WaterDepths[i]) / units(240), -1, 1);
    x += dx * gain;
    y += dy * gain;
  }
  return [x, y];
}
function seedDirections(map: PhysicalField, c: PhysicalContext) {
  const scale = Math.max(18, map.mesh.contentRadius * 0.46);
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
      const difference = potential[j] - potential[i];
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
function smoothDirections(map: PhysicalField, iterations: number) {
  const nx = new Int32Array(map.mesh.count),
    ny = new Int32Array(map.mesh.count);
  for (let pass = 0; pass < iterations; pass++) {
    for (let i = 0; i < map.mesh.count; i++) {
      if (map.WaterKindCodes[i] !== 1) continue;
      let x = map.OceanCurrentX[i] * 3,
        y = map.OceanCurrentY[i] * 3,
        weight = 3;
      for (let edge = 0; edge < 3; edge++) {
        const j = map.mesh.neighbors[i * 3 + edge];
        if (j >= 0 && map.WaterKindCodes[j] === 1) {
          x += map.OceanCurrentX[j];
          y += map.OceanCurrentY[j];
          weight++;
        }
      }
      [nx[i], ny[i]] = normalized(x / weight, y / weight);
    }
    map.OceanCurrentX.set(nx);
    map.OceanCurrentY.set(ny);
  }
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
        Math.max(20, map.mesh.contentRadius * 0.38),
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
function transportHeat(map: PhysicalField, iterations: number, targets: Int32Array) {
  const source = heatSources(map),
    next = new Int32Array(map.mesh.count);
  for (let pass = 0; pass < iterations; pass++) {
    for (let i = 0; i < map.mesh.count; i++) {
      if (map.WaterKindCodes[i] !== 1) {
        next[i] = 0;
        continue;
      }
      const advected = targets[i] >= 0 ? map.OceanCurrentHeat[targets[i]] : 0;
      next[i] = Math.max(
        source[i],
        Math.max(0, truncate((map.OceanCurrentHeat[i] * 3 + advected * 7) / 10) - 5)
      );
    }
    map.OceanCurrentHeat.set(next);
  }
}
function waveExposure(map: PhysicalField, steps: number, targets: Int32Array) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    let fetch = 0,
      current = i,
      previous = -1;
    while (fetch < steps) {
      const next = targets[current];
      if (next < 0 || next === previous) break;
      fetch++;
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
  smoothDirections(map, c.Profile.OceanCurrentSmoothingIterations);
  measureStrength(map, c);
  const upstream = upstreamNeighbors(map);
  transportHeat(map, c.Profile.OceanCurrentHeatIterations, upstream);
  waveExposure(map, c.Profile.OceanCurrentFetchSteps, upstream);
}
