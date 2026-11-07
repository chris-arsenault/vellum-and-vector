// AtmosphericFlow.cs and AtmosphericFlowLayer.cs, Canonry 0f62584c.
import { EpochStamps } from "@atlas/domain";
import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, round, toUnits, truncate } from "./math";
import { meshWorldNoise as fractalNoise } from "./noise";
import { latitudeAt } from "./latitude";
import { deflectWind, windSpeed, windTerrain } from "./windTerrain";
import { physicalDistance } from "./physicalMetric";
import { wrapLinks } from "./longitudeWrap";

export function alignedNeighbor(map: PhysicalField, i: number, dx: number, dy: number): number {
  let best = -1,
    score = -Number.MAX_VALUE;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j < 0) continue;
    const alignment = map.mesh.edgeX(i, edge) * dx + map.mesh.edgeY(i, edge) * dy;
    if (alignment > score) {
      best = j;
      score = alignment;
    }
  }
  return best;
}
/**
 * Surface flow of the latitude-anchored circulation cells. Even cells from the
 * equator (Hadley, polar) blow from the east and toward the equator; odd
 * (Ferrel) cells blow from the west and toward the pole. Meridional flow is
 * strongest mid-cell and vanishes at the convergent and divergent boundaries.
 */
export function circulation(p: PhysicalProfile, latitude: number): [number, number] {
  const cells = Math.max(1, p.CirculationCellsPerHemisphere),
    width = 90 / cells;
  const poleward = latitude >= 0 ? 1 : -1,
    distance = Math.min(89.999, Math.abs(latitude));
  const cell = Math.floor(distance / width),
    within = Math.sin(((distance - cell * width) / width) * Math.PI);
  const westerly = (cell & 1) === 1;
  return [
    westerly ? 1 : -1,
    (westerly ? poleward : -poleward) * within * (p.CirculationCellTurn / 1000),
  ];
}
/** Mid-cell belt speed in m/s, falling to a calm floor at the cell boundaries. */
export function beltSpeed(p: PhysicalProfile, latitude: number) {
  const cells = Math.max(1, p.CirculationCellsPerHemisphere),
    width = 90 / cells,
    distance = Math.min(89.999, Math.abs(latitude));
  const cell = Math.floor(distance / width),
    within = Math.sin(((distance - cell * width) / width) * Math.PI);
  const peak =
    (cell & 1) === 1 ? p.WindSpeedWesterlies : cell === 0 ? p.WindSpeedTrades : p.WindSpeedPolar;
  return peak * (0.3 + 0.7 * within);
}
function windDirection(map: PhysicalField, c: PhysicalContext, i: number): [number, number] {
  const p = c.Profile;
  const [along, across] = circulation(p, latitudeAt(p, map, i));
  // World coordinates and a fixed scale keep a region's wander equal to its parent's.
  const wander =
    fractalNoise(
      map.mesh,
      map.mesh.x(i) + map.mesh.origin[0],
      map.mesh.y(i) + map.mesh.origin[1],
      c.Seed ^ 0x713b,
      p.CirculationWanderScale,
      3
    ) *
    (p.CirculationWander / 1000);
  // Meridional components are applied in the world frame, where north is +y.
  const angle = Math.atan2(across, along) + wander;
  return [Math.cos(angle), Math.sin(angle)];
}
function traceAirMass(map: PhysicalField, scale: number, start: number, visited: EpochStamps) {
  let current = start,
    barrier = 0,
    moistureBarrier = -1,
    ocean = -1;
  const startElevation = map.Elevation.get(start);
  visited.begin();
  for (let distance = 0; distance < 180_000;) {
    const next = map.UpwindTargets.get(current);
    if (next < 0 || visited.marked(next)) break;
    distance += physicalDistance(map.mesh, current, next);
    if (distance > 180_000) break;
    visited.mark(next);
    current = next;
    barrier = Math.max(barrier, map.Elevation.get(current) - startElevation);
    if (distance <= 140_000) moistureBarrier = barrier;
    if (map.WaterKindCodes.get(current) === 1) {
      ocean = current;
      break;
    }
  }
  const normalize = (value: number) =>
    clamp(truncate((toUnits(value) * 1000) / Math.max(1, truncate(scale / 2))), 0, 1000);
  map.MoistureBarriers.set(start, normalize(moistureBarrier < 0 ? barrier : moistureBarrier));
  map.PrecipitationBarriers.set(start, normalize(barrier));
  map.UpwindOceanSources.set(start, ocean);
  return toUnits(barrier);
}
export function atmosphericFlow(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile,
    terrain = windTerrain(map, p);
  for (let i = 0; i < map.mesh.count; i++) {
    const [x, y] = deflectWind(terrain, p, i, ...windDirection(map, c, i));
    map.WindX.set(i, round(x * 1000));
    map.WindY.set(i, round(y * 1000));
    map.UpwindTargets.set(i, alignedNeighbor(map, i, -x, -y));
  }
  wrapLinks(map, p, map.UpwindTargets);
  const visited = new EpochStamps(map.mesh.count);
  for (let i = 0; i < map.mesh.count; i++) {
    const barrier = traceAirMass(map, p.ElevationScale, i, visited);
    map.WindSpeed.set(
      i,
      windSpeed(map, terrain, p, i, beltSpeed(p, latitudeAt(p, map, i)), barrier)
    );
  }
}
