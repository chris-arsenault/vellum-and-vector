// OceanCurrentLayer.cs, Canonry 0f62584c.
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { clamp, round, toUnits, truncate } from "./math";
import { meshUnitNoise as unitNoise } from "./noise";
import { prepareMetricSmoother } from "./metricSmoothing";
import { physicalDistance } from "./physicalMetric";
import { gyreDirections, intensifyWesternBoundaries, seaSurfaceAnomaly } from "./oceanGyres";
import { linkDistance, wrapLinks } from "./longitudeWrap";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";
import type { Band } from "@atlas/domain";

function normalized(x: number, y: number): [number, number] {
  const length = Math.sqrt(x * x + y * y);
  return length < 0.000001 ? [0, 0] : [round((x / length) * 1000), round((y / length) * 1000)];
}
function smoothDirections(map: PhysicalField, length: number) {
  const ocean = workingValues(map, "uint8", "currents:ocean", (i) =>
    Number(map.WaterKindCodes.get(i) === 1)
  );
  const smooth = prepareMetricSmoother(map, length, ocean);
  const x = smooth(map.OceanCurrentX),
    y = smooth(map.OceanCurrentY);
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 1) {
      const [cx, cy] = normalized(x.get(i), y.get(i));
      map.OceanCurrentX.set(i, cx);
      map.OceanCurrentY.set(i, cy);
    }
  smooth.close();
  releaseWorking(map, ocean, x, y);
}
function upstreamNeighbors(map: PhysicalField): Band {
  const targets = workingArray(map, "int32", "currents:upstream").fill(-1);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 1) continue;
    let best = 0;
    const cx = map.OceanCurrentX.get(i),
      cy = map.OceanCurrentY.get(i);
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j < 0 || map.WaterKindCodes.get(j) !== 1) continue;
      const f = Math.fround;
      const score = f(f(map.mesh.edgeX(i, edge) * -cx) + f(map.mesh.edgeY(i, edge) * -cy));
      if (score > best) {
        best = score;
        targets.set(i, j);
      }
    }
  }
  return targets;
}
function measureStrength(map: PhysicalField, c: PhysicalContext) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 1) continue;
    const depth = clamp(
      truncate((toUnits(map.WaterDepths.get(i)) * 420) / c.Profile.ShelfBreakDepth),
      0,
      420
    );
    const broad = round(
      unitNoise(
        map.mesh,
        map.mesh.x(i),
        map.mesh.y(i),
        c.Seed ^ 0x19af,
        Math.max(200_000, map.mesh.contentRadius * 0.38),
        2
      ) * 250
    );
    map.OceanCurrentStrength.set(
      i,
      clamp(c.Profile.OceanCurrentMinimumStrength + depth + broad, 1, 1000)
    );
  }
}
function heatSources(map: PhysicalField): Band {
  const source = workingArray(map, "int32", "currents:heat");
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 1) continue;
    let heat = map.Geothermal.get(i);
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0) heat = Math.max(heat, truncate((map.Geothermal.get(j) * 4) / 5));
    }
    const value = clamp(60 + truncate((heat * 4) / 5), 0, 1000);
    source.set(i, value);
    map.OceanCurrentHeat.set(i, value);
  }
  return source;
}
function upstreamHeat(
  map: PhysicalField,
  source: Band,
  targets: Band,
  start: number,
  reach: number,
  cooling: number,
  linkLength: (i: number, j: number) => number
) {
  let current = start,
    traveled = 0,
    heat = source.get(start);
  const visited = new Set([start]);
  while (traveled < reach) {
    const next = targets.get(current);
    if (next < 0 || visited.has(next)) break;
    const segment = linkLength(current, next);
    const distance = Math.min(segment, reach - traveled);
    const here = source.get(current);
    const mixed = here + ((source.get(next) - here) * distance) / segment;
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
  targets: Band,
  linkLength = (i: number, j: number) => physicalDistance(map.mesh, i, j)
) {
  const source = heatSources(map);
  for (let i = 0; reach > 0 && i < map.mesh.count; i++)
    if (map.WaterKindCodes.get(i) === 1)
      map.OceanCurrentHeat.set(
        i,
        round(upstreamHeat(map, source, targets, i, reach, cooling, linkLength))
      );
  releaseWorking(map, source);
}
function waveExposure(
  map: PhysicalField,
  steps: number,
  targets: Band,
  linkLength: (i: number, j: number) => number
) {
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 1) continue;
    let fetch = 0,
      current = i,
      previous = -1;
    const visited = new Set([i]);
    while (fetch < steps) {
      const next = targets.get(current);
      if (next < 0 || next === previous || visited.has(next)) break;
      visited.add(next);
      fetch += linkLength(current, next);
      previous = current;
      current = next;
    }
    map.WaveExposure.set(
      i,
      clamp(
        truncate((fetch * 760) / steps) + truncate((map.OceanCurrentStrength.get(i) * 240) / 1000),
        0,
        1000
      )
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
  wrapLinks(map, c.Profile, upstream, (k) => map.WaterKindCodes.get(k) === 1);
  const linkLength = linkDistance(map, c.Profile);
  seaSurfaceAnomaly(map, c, upstream);
  // Water moved by an external force (a Pressure front) upwells and cools or warms the
  // surface on top of the gyre circulation; the climate pass then carries it ashore.
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes.get(i) !== 1) continue;
    map.Upwelling.set(
      i,
      clamp(round(map.Upwelling.get(i) + map.ExternalUpwelling.get(i)), 0, 1000)
    );
    map.SeaSurfaceAnomaly.set(
      i,
      round(map.SeaSurfaceAnomaly.get(i) + map.ExternalSeaSurfaceForcing.get(i))
    );
  }
  transportOceanHeat(
    map,
    c.Profile.OceanCurrentHeatDistance,
    c.Profile.OceanCurrentHeatCooling,
    upstream,
    linkLength
  );
  waveExposure(map, c.Profile.OceanCurrentFetchDistance, upstream, linkLength);
  releaseWorking(map, western, upstream);
}
