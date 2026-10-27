import type { PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import type { PhysicalProfile } from "./profile";
import { clamp, round } from "./math";
import { latitudeAt, metresPerDegree } from "./latitude";
import { circulation } from "./atmosphere";
import { insolationTemperature } from "./climate";
import { PriorityQueue } from "./priorityQueue";
import { physicalGradients } from "./physicalMetric";
import { sourceOrder } from "./airColumn";
import { smoothMetric } from "./metricSmoothing";
import { linkDistance } from "./longitudeWrap";
import { workingArray, workingValues, releaseWorking } from "./physicalNumerics";
import type { NumericalVector } from "@atlas/domain";

const unit = (value: number) => Math.min(1, Math.max(0, value));

/** Subtropical gyres span the trades and the equatorward half of the westerlies. */
function subtropical(c: PhysicalContext, latitude: number) {
  return Math.abs(latitude) < (90 / Math.max(1, c.Profile.CirculationCellsPerHemisphere)) * 1.5;
}
/**
 * Turn the drift along a coast in its gyre's sense. The normal points toward
 * land; its eastward part says whether this is a western or eastern boundary.
 * Subtropical gyres run poleward on western boundaries and equatorward on
 * eastern ones, where offshore transport raises upwelling; subpolar gyres reverse.
 */
function coastalFlow(
  c: PhysicalContext,
  latitude: number,
  [x, y]: [number, number],
  [nx, ny]: [number, number],
  proximity: number
) {
  const weight = unit(proximity * 2.5) * Math.abs(nx);
  const poleward = latitude >= 0 ? 1 : -1,
    gyre = subtropical(c, latitude) ? 1 : -1,
    boundary = nx < 0 ? 1 : -1;
  let [tx, ty] = [-ny, nx];
  if (ty * poleward * gyre * boundary < 0) [tx, ty] = [-tx, -ty];
  const length = Math.hypot(x, y);
  return {
    x: (1 - weight) * (x / length) + weight * tx,
    y: (1 - weight) * (y / length) + weight * ty,
    western: nx < 0 ? weight : 0,
    upwelling: nx > 0 && gyre > 0 && ty * poleward < 0 ? weight : 0,
  };
}
/**
 * Wind-driven drift turned along coasts in each gyre's sense. Returns the
 * western-boundary weight used for intensification and records upwelling.
 */
/** Zero on land; at sea, half the edge to the nearest land neighbour, or `reach` offshore. */
function shoreDistance(map: PhysicalField, i: number, reach: number) {
  if (map.WaterKindCodes[i] !== 1) return 0;
  let distance = reach;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (j >= 0 && map.WaterKindCodes[j] !== 1)
      distance = Math.min(distance, map.mesh.edgeLength[i * map.mesh.stride + edge] / 2);
  }
  return distance;
}
/** Shortest ocean-path distance from each ocean cell to the coast, up to `reach`. */
function coastDistance(map: PhysicalField, reach: number) {
  return oceanPathDistance(
    map,
    workingValues(map, "float64", "ocean:coast-distance", (i) => shoreDistance(map, i, reach)),
    reach
  );
}
/** Ocean-path distance onward from cells whose starting distance is below `reach`. */
function oceanPathDistance(map: PhysicalField, start: NumericalVector, reach: number) {
  const mesh = map.mesh,
    distances = start;
  const queue = new PriorityQueue<{ i: number; distance: number }>(
    (a, b) => a.distance - b.distance,
    map.numerical,
    ["i", "distance"]
  );
  for (let i = 0; i < mesh.count; i++)
    if (map.WaterKindCodes[i] === 1 && distances[i] < reach)
      queue.push({ i, distance: distances[i] });
  while (queue.count) {
    const { i, distance } = queue.pop();
    if (distance !== distances[i]) continue;
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const j = mesh.neighbors[i * mesh.stride + edge],
        next = distance + mesh.edgeLength[i * mesh.stride + edge];
      if (j < 0 || map.WaterKindCodes[j] !== 1 || next >= distances[j]) continue;
      distances[j] = next;
      queue.push({ i: j, distance: next });
    }
  }
  return distances;
}
export function gyreDirections(map: PhysicalField, c: PhysicalContext) {
  const p = c.Profile,
    mesh = map.mesh;
  // Proximity falls from one at the shore; its gradient points toward land.
  const distance = coastDistance(map, p.GyreCoastalLength * 3);
  const coast = workingValues(
    map,
    "float64",
    "ocean:coast",
    (i) => Math.exp(-distance[i] / p.GyreCoastalLength) / 2
  );
  const normal = physicalGradients(mesh, coast, map.numerical);
  const western = workingArray(map, "float64", "ocean:western");
  map.Upwelling.fill(0);
  for (let i = 0; i < mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    const latitude = latitudeAt(p, map, i),
      slope = Math.hypot(normal.x[i], normal.y[i]);
    const flow = coastalFlow(
      c,
      latitude,
      circulation(p, latitude),
      slope > 0 ? [normal.x[i] / slope, normal.y[i] / slope] : [0, 0],
      coast[i]
    );
    western[i] = flow.western;
    map.Upwelling[i] = round(flow.upwelling * 1000);
    const length = Math.max(1e-9, Math.hypot(flow.x, flow.y));
    map.OceanCurrentX[i] = round((flow.x / length) * 1000);
    map.OceanCurrentY[i] = round((flow.y / length) * 1000);
  }
  releaseWorking(map, distance, coast, normal.x, normal.y);
  return western;
}
export function intensifyWesternBoundaries(
  map: PhysicalField,
  c: PhysicalContext,
  western: NumericalVector
) {
  for (let i = 0; i < map.mesh.count; i++)
    if (western[i] > 0)
      map.OceanCurrentStrength[i] = clamp(
        round(map.OceanCurrentStrength[i] * (1 + c.Profile.GyreBoundaryStrength * western[i])),
        1,
        1000
      );
}
/** Equilibrium sea-surface temperature from latitude alone, in native units. */
function equilibrium(map: PhysicalField, c: PhysicalContext, i: number) {
  return (
    c.Profile.TemperatureBaseline +
    c.TemperatureOffset +
    insolationTemperature(c.Profile, latitudeAt(c.Profile, map, i))
  );
}
/**
 * Surface water carries the temperature of where it came from, relaxing toward
 * the local equilibrium with distance; upwelling brings up cold water.
 */
export function seaSurfaceAnomaly(
  map: PhysicalField,
  c: PhysicalContext,
  upstream: NumericalVector
) {
  const p = c.Profile,
    mixed = mixFronts(map, p, carriedAnomaly(map, c, upstream));
  for (let i = 0; i < map.mesh.count; i++)
    map.SeaSurfaceAnomaly[i] =
      map.WaterKindCodes[i] === 1
        ? round(mixed[i] - (map.Upwelling[i] * p.UpwellingCooling) / 1000)
        : 0;
  releaseWorking(map, mixed);
}
/** Departure of carried water from the local equilibrium, scaled by transport. */
function carriedAnomaly(map: PhysicalField, c: PhysicalContext, upstream: NumericalVector) {
  const p = c.Profile;
  // Exponentially weighted upstream averages, accumulated in one pass from
  // each current's source: total = own + decay × upstream total.
  const sums = workingArray(map, "float64", "ocean:heat-sum"),
    weights = workingArray(map, "float64", "ocean:heat-weight"),
    carried = workingArray(map, "float64", "ocean:carried-heat"),
    distance = linkDistance(map, p),
    { order, boundary } = sourceOrder(upstream, map.numerical);
  // Gyres are closed loops: the second pass lets each loop's break read the
  // first pass's upstream value, so heat carries around the circuit.
  for (const pass of [0, 1])
    for (const i of order) {
      if (map.WaterKindCodes[i] !== 1) continue;
      const u = boundary[i] && pass === 0 ? -1 : upstream[i],
        local = equilibrium(map, c, i);
      const decay =
        u < 0 || map.WaterKindCodes[u] !== 1
          ? 0
          : Math.exp(-distance(u, i) / p.SeaSurfaceRelaxation);
      sums[i] = local + (decay ? decay * sums[u] : 0);
      weights[i] = 1 + (decay ? decay * weights[u] : 0);
      const transport = Math.min(1, map.OceanCurrentStrength[i] / 600);
      carried[i] = (sums[i] / weights[i] - local) * transport;
    }
  releaseWorking(map, sums, weights, order, boundary);
  return carried;
}
/**
 * Eddies mix water where opposing drifts meet, so a circulation cell boundary
 * is a front rather than a step; aligned boundary currents stay sharp. Mixing
 * is solved only within three lengths of a front, where its weight exceeds e⁻⁹.
 * On a map with few kilometres per degree the length shrinks to a few degrees,
 * so a front never spans a whole belt.
 */
function mixFronts(map: PhysicalField, p: PhysicalProfile, carried: NumericalVector) {
  const length = Math.min(p.SeaSurfaceMixing, p.SeaSurfaceMixingDegrees * metresPerDegree(p)),
    opposing = opposition(map),
    reach = length * 3,
    front = oceanPathDistance(
      map,
      workingValues(map, "float64", "ocean:front-distance", (i) => (opposing[i] > 0.5 ? 0 : reach)),
      reach
    ),
    zone = workingValues(map, "uint8", "ocean:mixing-zone", (i) =>
      Number(map.WaterKindCodes[i] === 1 && front[i] < reach)
    ),
    mixed = zone.some(Boolean)
      ? smoothMetric(map.mesh, carried, length, zone, map.numerical)
      : carried;
  for (let i = 0; i < carried.length; i++) {
    const w = Math.exp(-((front[i] / length) ** 2));
    carried[i] += w * (mixed[i] - carried[i]);
  }
  releaseWorking(map, opposing, zone, front, ...(mixed !== carried ? [mixed] : []));
  return carried;
}
/** How directly each ocean cell's drift opposes a neighbour's: one head-on, zero aligned. */
function opposition(map: PhysicalField) {
  const mesh = map.mesh,
    result = workingArray(map, "float64", "ocean:opposition");
  for (let i = 0; i < mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    for (let edge = 0; edge < mesh.degree[i]; edge++) {
      const j = mesh.neighbors[i * mesh.stride + edge];
      if (j < 0 || map.WaterKindCodes[j] !== 1) continue;
      const dot =
        (map.OceanCurrentX[i] * map.OceanCurrentX[j] +
          map.OceanCurrentY[i] * map.OceanCurrentY[j]) /
        1e6;
      result[i] = Math.max(result[i], -dot);
    }
  }
  return result;
}
