// Landmark geometry in the mesh frame, signature sampling, and the supported bedrock changes
// every kind writes through.
import { landmarkKind, type Landmark } from "@atlas/domain";
import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { clamp, units } from "./math";
import { meshDeltaX, meshPoint, nearestTriangle } from "./mesh";
import { displaceGround, excavateRock, recordCut } from "../rock/groundLedger";
import { physicalSampler } from "./physicalMetric";
import { advanceTectonicPoint, backtrackTectonicPoint } from "./tectonicIntegration";
import { plateTravel, tectonicDefaultMyr } from "./tectonicControls";

export type Point = [number, number];
export interface Placed {
  landmark: Landmark;
  center: Point;
  path: Point[];
  parameters: Record<string, number>;
}
export interface PathMetrics {
  total: number;
  segments: { ax: number; ay: number; ex: number; ey: number; length: number; from: number }[];
}
export interface PathHit {
  distance: number;
  along: number;
  /** Positive on the left of the drawn direction, negative on the right. */
  side: number;
}
export interface Station {
  x: number;
  y: number;
  nx: number;
  ny: number;
  along: number;
}
export type Sampler = (x: number, y: number) => number;

/* ---------- placement ---------- */

function toMesh(map: PhysicalField, [x, y]: number[]): Point {
  return meshPoint(map.mesh, x - map.mesh.origin[0], y - map.mesh.origin[1]);
}
/** Plate drift per epoch in metres, as `plateAdvection` applies it; empty when advection is off. */
export function plateDriftSteps(
  p: PhysicalProfile,
  epochs: number | readonly { tectonicDurationMyr?: number; tectonics?: number }[],
  enabled = true
) {
  if (!enabled) return [];
  const list = typeof epochs === "number" ? Array.from({ length: epochs }, () => ({})) : epochs;
  return list.map((epoch: { tectonicDurationMyr?: number; tectonics?: number }) =>
    plateTravel(p, epoch.tectonicDurationMyr ?? tectonicDefaultMyr, (epoch.tectonics ?? 1) * 1000)
  );
}
/**
 * The landmark rides the crust like every other feature, so its authored position is where
 * it stands at present. Walk it back through the drift of the epochs still to come.
 */
function backTrack(map: PhysicalField, point: Point, drift: number[], epoch: number): Point {
  const remaining = drift.slice(epoch + 1).filter((step) => step > 0);
  if (!remaining.length) return point;
  if (map.tectonics) return backtrackTectonicPoint(map, point, remaining);
  const vx = physicalSampler(map.mesh, map.CrustMotionX),
    vy = physicalSampler(map.mesh, map.CrustMotionY);
  let [x, y] = point;
  for (const step of remaining.reverse())
    [x, y] = meshPoint(map.mesh, x - (vx(x, y) / 1000) * step, y - (vy(x, y) / 1000) * step);
  return [x, y];
}
/**
 * The present-day position of a site chosen on the mesh at this epoch: the drift of the
 * epochs still to come carries it forward, as `backTrack` walks an authored position back.
 */
export function forwardTrack(map: PhysicalField, point: Point, drift: number[], epoch: number) {
  const remaining = drift.slice(epoch + 1).filter((step) => step > 0);
  if (!remaining.length) return point;
  if (map.tectonics) return advanceTectonicPoint(map, point, remaining);
  const vx = physicalSampler(map.mesh, map.CrustMotionX),
    vy = physicalSampler(map.mesh, map.CrustMotionY);
  let [x, y] = point;
  for (const step of remaining)
    [x, y] = meshPoint(map.mesh, x + (vx(x, y) / 1000) * step, y + (vy(x, y) / 1000) * step);
  return [x, y] as Point;
}
export function placeLandmark(
  map: PhysicalField,
  landmark: Landmark,
  drift: number[] = [],
  epoch = drift.length
): Placed | null {
  if (!landmarkKind(landmark.kind)) return null;
  const geometry = landmark.geometry,
    place = (c: number[]) => backTrack(map, toMesh(map, c), drift, epoch);
  if (geometry.type === "Point") {
    const center = place(geometry.coordinates);
    return { landmark, center, path: [center], parameters: landmark.parameters };
  }
  if (geometry.type !== "LineString" || geometry.coordinates.length < 2) return null;
  const path = geometry.coordinates.map(place);
  return { landmark, center: path[0], path, parameters: landmark.parameters };
}
export function distance(map: PhysicalField, i: number, [x, y]: Point) {
  return Math.hypot(meshDeltaX(map.mesh, map.mesh.x(i) - x), map.mesh.y(i) - y);
}
export function pathMetrics(map: PhysicalField, path: Point[]): PathMetrics {
  const segments: PathMetrics["segments"] = [];
  let total = 0;
  for (let k = 0; k + 1 < path.length; k++) {
    const [ax, ay] = path[k],
      ex = meshDeltaX(map.mesh, path[k + 1][0] - ax),
      ey = path[k + 1][1] - ay,
      length = Math.hypot(ex, ey);
    if (length === 0) continue;
    segments.push({ ax, ay, ex, ey, length, from: total });
    total += length;
  }
  return { total, segments };
}
export function nearestOnPath(
  map: PhysicalField,
  metrics: PathMetrics,
  x: number,
  y: number
): PathHit {
  let best: PathHit = { distance: Infinity, along: 0, side: 1 };
  for (const s of metrics.segments) {
    const dx = meshDeltaX(map.mesh, x - s.ax),
      dy = y - s.ay;
    const t = clamp((dx * s.ex + dy * s.ey) / (s.length * s.length), 0, 1);
    const px = s.ax + t * s.ex,
      py = s.ay + t * s.ey;
    const d = Math.hypot(meshDeltaX(map.mesh, x - px), y - py);
    if (d < best.distance) {
      const cross = s.ex * dy - s.ey * dx;
      best = { distance: d, along: s.from + t * s.length, side: cross >= 0 ? 1 : -1 };
    }
  }
  return best;
}
/** Points along the path every `step` metres with their left-hand normal. */
export function stations(map: PhysicalField, metrics: PathMetrics, step: number): Station[] {
  const result: Station[] = [];
  for (const s of metrics.segments) {
    const nx = -s.ey / s.length,
      ny = s.ex / s.length;
    for (let a = 0; a < s.length; a += step) {
      const t = a / s.length;
      result.push({ x: s.ax + t * s.ex, y: s.ay + t * s.ey, nx, ny, along: s.from + a });
    }
  }
  const last = metrics.segments.at(-1);
  if (last)
    result.push({
      x: last.ax + last.ex,
      y: last.ay + last.ey,
      nx: -last.ey / last.length,
      ny: last.ex / last.length,
      along: metrics.total,
    });
  return result;
}

/* ---------- measurement ---------- */

export function heightSampler(map: PhysicalField): Sampler {
  const at = physicalSampler(map.mesh, map.Elevation);
  return (x, y) => {
    const [mx, my] = meshPoint(map.mesh, x, y);
    const cell = nearestTriangle(map.mesh, mx, my);
    return cell === undefined || cell < 0 ? NaN : at(mx, my);
  };
}
export function mean(values: number[]) {
  const finite = values.filter((v) => Number.isFinite(v));
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : NaN;
}
export function ring(height: Sampler, [cx, cy]: Point, radius: number) {
  const samples: number[] = [];
  for (let direction = 0; direction < 16; direction++) {
    const angle = (direction * Math.PI) / 8;
    samples.push(height(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius));
  }
  return mean(samples);
}
/** Mean height across a band of offsets on one side of a station (metres from the line). */
export function bank(
  height: Sampler,
  station: Station,
  side: number,
  inner: number,
  outer: number
) {
  const samples: number[] = [];
  for (let k = 0; k < 3; k++) {
    const offset = side * (inner + ((outer - inner) * k) / 2);
    samples.push(height(station.x + station.nx * offset, station.y + station.ny * offset));
  }
  return mean(samples);
}
/** The lowest cell at or beside a station: the channel cell. */
export function channelCell(map: PhysicalField, station: { x: number; y: number }) {
  const centre = nearestTriangle(map.mesh, station.x, station.y);
  if (centre === undefined || centre < 0) return -1;
  let best = centre;
  for (let edge = 0; edge < map.mesh.degree(centre); edge++) {
    const j = map.mesh.neighbor(centre, edge);
    if (j >= 0 && map.Elevation.get(j) < map.Elevation.get(best)) best = j;
  }
  return best;
}
/** Summit targets stay relative to formation sea level, so later tides do not rebuild a mountain. */
export const metres = (map: PhysicalField, elevation: number) =>
  MapScale.metres(elevation - map.BaseSeaLevel, "native");
export const unitsAbove = (map: PhysicalField, value: number) => map.BaseSeaLevel + units(value);

/* ---------- supported changes ---------- */

/**
 * Move bedrock as constructed rock, the way a volcano is built: the surface rock load changes
 * and the next crustal-support pass answers it with flexure. No material is produced.
 */
export function shiftBedrock(map: PhysicalField, i: number, requested: number) {
  if (requested === 0) return 0;
  displaceGround(map, i, requested, "landmarks");
  return requested;
}
/** A cut booked as river incision down to base level; the sediment leaves through transport. */
export function cut(map: PhysicalField, i: number, requested: number) {
  const base = map.EffectiveSeaLevel + units(map.scale.length(0.00000025));
  const amount = Math.min(requested, map.Elevation.get(i) - base);
  if (amount <= 0) return 0;
  recordCut(map, i, amount, 1, "landmarks");
  return amount;
}
/** Excavation that leaves the map, as an impact's does. */
export function excavate(map: PhysicalField, i: number, requested: number) {
  if (requested <= 0) return 0;
  const amount = excavateRock(map, i, requested, "landmarks", "space");
  map.ImpactExcavation.add(i, amount);
  const volume = MapScale.metres(amount, "native") * map.mesh.area(i);
  map.SedimentProducedTotal += volume;
  map.SedimentExportedTotal += volume;
  return amount;
}

/* ---------- scale ---------- */

/** Realized when the defining dimension spans at least two cells (rings: one cell apart). */
export function realizedAt(map: PhysicalField, placed: Placed) {
  const p = placed.parameters,
    span = map.scale.cells(1),
    length = pathMetrics(map, placed.path).total;
  // A magic source is realized where its reach covers at least the cell it is injected in.
  if (landmarkKind(placed.landmark.kind)?.system) return MapScale.metres(p.reach, "km") >= span;
  switch (placed.landmark.kind) {
    case "volcanic-mountain":
    case "resistant-mountain":
      return MapScale.metres(p.baseRadius, "km") * 2 >= map.scale.cells(2);
    case "canyon":
    case "escarpment":
      return length >= 2 * span;
    case "dome-ring":
      return (
        MapScale.metres(p.diameter, "km") >= map.scale.cells(2) &&
        MapScale.metres(p.diameter, "km") / (2 * p.ringCount) >= span
      );
    case "impact-ring":
      return MapScale.metres(p.diameter, "km") >= map.scale.cells(2);
    default:
      return false;
  }
}
import { MapScale } from "@atlas/domain";
