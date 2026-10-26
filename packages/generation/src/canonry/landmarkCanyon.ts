// The great canyon: resistant rims, a channel incised below them, and a captured river.
import type { PhysicalField } from "./field";
import type { PhysicalProfile } from "./profile";
import { clamp, rockResistance, round, units } from "./math";
import { meshDeltaX } from "./mesh";
import {
  channelCell,
  cut,
  distance,
  mean,
  nearestOnPath,
  pathMetrics,
  shiftBedrock,
  stations,
  type Placed,
} from "./landmarkGeometry";
import { note, type LandmarkRecord } from "./landmarkLedger";
import type { Kind } from "./landmarkKind";

const baseLevel = (map: PhysicalField) => map.EffectiveSeaLevel + units(1);

/**
 * Floor cells of a canyon with their station index, and the rim cells beside them. At a mesh
 * where the rim width is a cell or less the floor is one cell wide and the rims are the next
 * cells out, so both bands are always at least a cell wide. A captured river's corridor is
 * part of the floor at the head.
 */
export function canyonCells(map: PhysicalField, placed: Placed, corridor: Iterable<number> = []) {
  const metrics = pathMetrics(map, placed.path),
    width = placed.parameters.rimWidth * 1000,
    floorWidth = Math.max(width / 4, map.mesh.spacing * 0.55),
    rimReach = Math.max(width, floorWidth + map.mesh.spacing * 1.2),
    step = map.mesh.spacing / 2,
    line = stations(map, metrics, step),
    channel = new Set(corridor);
  const floor: { i: number; station: number }[] = [],
    rims: { i: number; d: number; station: number }[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    const hit = nearestOnPath(map, metrics, map.mesh.x[i], map.mesh.y[i]);
    if (hit.distance > rimReach) {
      if (channel.has(i)) floor.push({ i, station: 0 });
      continue;
    }
    const station = Math.min(line.length - 1, Math.round(hit.along / step));
    if (hit.distance <= floorWidth) floor.push({ i, station });
    else if (channel.has(i)) floor.push({ i, station: 0 });
    else rims.push({ i, d: hit.distance, station });
  }
  return { metrics, width, floorWidth, rimReach, step, line, floor, rims };
}
/** Fill stations without cells of their own from the nearest station that has some. */
function fillAlong(values: Float64Array) {
  const filled = values.slice();
  for (let k = 0; k < filled.length; k++) {
    if (Number.isFinite(filled[k])) continue;
    for (let reach = 1; reach < filled.length; reach++) {
      const near = [values[k - reach], values[k + reach]].find((v) => Number.isFinite(v));
      if (near !== undefined) {
        filled[k] = near;
        break;
      }
    }
  }
  return filled;
}
/** Rim and channel levels (units) at each station: mean rim cell and lowest floor cell. */
export function canyonProfile(map: PhysicalField, placed: Placed, corridor: Iterable<number> = []) {
  const geometry = canyonCells(map, placed, corridor),
    count = geometry.line.length,
    rimSum = new Float64Array(count),
    rimCount = new Float64Array(count),
    floorLevel = new Float64Array(count).fill(NaN);
  for (const { i, station } of geometry.rims) {
    rimSum[station] += map.Elevation[i];
    rimCount[station]++;
  }
  for (const { i, station } of geometry.floor)
    floorLevel[station] = Math.min(
      Number.isFinite(floorLevel[station]) ? floorLevel[station] : Infinity,
      map.Elevation[i]
    );
  const rimLevel = fillAlong(
    Float64Array.from(rimSum, (sum, k) => (rimCount[k] ? sum / rimCount[k] : NaN))
  );
  return { ...geometry, rimLevel, floorLevel: fillAlong(floorLevel) };
}
/**
 * Cut the channel to a floor the target depth below the rims, descending from the head. Where
 * base level stops the cut, the rims rise by the remainder instead: the plateau the canyon
 * needs is lifted around it.
 */
function deepenCanyon(
  map: PhysicalField,
  p: PhysicalProfile,
  placed: Placed,
  depth: number,
  book: boolean,
  corridor: Iterable<number>
) {
  const profile = canyonProfile(map, placed, corridor),
    count = profile.line.length,
    target = new Float64Array(count),
    base = baseLevel(map);
  // A captured river may already have cut the head deeper; the floor descends from there.
  let previous = Number.isFinite(profile.floorLevel[0])
      ? profile.floorLevel[0] + units(0.2)
      : Infinity,
    applied = 0;
  for (let k = 0; k < count; k++) {
    const rim = Number.isFinite(profile.rimLevel[k]) ? profile.rimLevel[k] : profile.floorLevel[k];
    target[k] = Math.min(previous - units(0.2), rim - depth);
    previous = target[k];
  }
  for (const { i, station } of profile.floor) {
    const done = cut(map, i, map.Elevation[i] - target[station]);
    applied = Math.max(applied, done);
    if (book) map.LandmarkMaintenance[i] += done;
  }
  // The rim band rises by the full remainder: its mean is what the depth is measured against.
  for (const { i, station } of profile.rims) {
    const remainder = round(Math.max(0, base - target[station]));
    if (remainder <= 0) continue;
    const done = shiftBedrock(map, i, remainder);
    if (book) map.LandmarkMaintenance[i] += done;
    applied = Math.max(applied, done);
  }
  return applied;
}

/* ---------- river capture, shared by the water landmarks ---------- */

/** Straight corridor from a river cell down into a landmark's head cell, cut as incision. */
function cutCorridor(map: PhysicalField, from: number, to: number, floorWidth: number) {
  const ax = map.mesh.x[from],
    ay = map.mesh.y[from],
    ex = meshDeltaX(map.mesh, map.mesh.x[to] - ax),
    ey = map.mesh.y[to] - ay,
    length = Math.hypot(ex, ey);
  // The corridor leaves as the river cell's steepest exit, below every neighbour it has, and
  // falls to the head faster than the river fell before, so the descent chooses it over the
  // old course. Below base level no cut can win the water.
  let lowest = map.Elevation[from];
  for (let edge = 0; edge < map.mesh.degree[from]; edge++) {
    const j = map.mesh.neighbors[from * map.mesh.stride + edge];
    if (j >= 0) lowest = Math.min(lowest, map.Elevation[j]);
  }
  const start = lowest - units(3);
  if (start <= baseLevel(map)) return null;
  const exit = map.FlowTargets[from];
  const fall =
    exit >= 0
      ? (map.Elevation[from] - map.Elevation[exit]) /
        Math.max(1, distance(map, exit, [map.mesh.x[from], map.mesh.y[from]]))
      : 0;
  const gradient = Math.max(2 / 1000, 1.5 * fall);
  const end = Math.min(map.Elevation[to], start - units(2) - gradient * length);
  const cells: number[] = [];
  let applied = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (i === from) continue;
    const dx = meshDeltaX(map.mesh, map.mesh.x[i] - ax),
      dy = map.mesh.y[i] - ay,
      t = length ? clamp((dx * ex + dy * ey) / (length * length), 0, 1) : 0;
    const off = Math.hypot(meshDeltaX(map.mesh, dx - t * ex), dy - t * ey);
    if (off > floorWidth && i !== to) continue;
    const level = start + ((end - start) * (t * length)) / Math.max(1, length);
    const done = cut(map, i, map.Elevation[i] - level);
    map.LandmarkMaintenance[i] += done;
    applied = Math.max(applied, done);
    cells.push(i);
  }
  return { applied, cells };
}
function flowsInto(map: PhysicalField, from: number, floor: Set<number>, steps: number) {
  let i = from;
  for (let n = 0; n < steps && i >= 0; n++) {
    if (floor.has(i)) return true;
    i = map.FlowTargets[i];
  }
  return false;
}
/** True when the flow from `from` enters the sea within `steps` cells. */
function reachesSea(map: PhysicalField, from: number, steps: number) {
  let i = from;
  for (let n = 0; n < steps && i >= 0; n++) {
    if (map.WaterKindCodes[i] === 1) return true;
    i = map.FlowTargets[i];
  }
  return false;
}
/**
 * Land river cells within reach of the head that a cut could divert, largest accumulation
 * first: above base level and not about to discharge into the sea.
 */
function riversNear(map: PhysicalField, head: number, reach: number, floor: Set<number>) {
  const base = baseLevel(map),
    nearSea = Math.ceil(reach / map.mesh.spacing),
    candidates: number[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 0 || map.RiverOrders[i] <= 0 || floor.has(i)) continue;
    if (map.Elevation[i] <= base + units(5) || reachesSea(map, i, nearSea)) continue;
    if (distance(map, i, [map.mesh.x[head], map.mesh.y[head]]) > reach) continue;
    candidates.push(i);
  }
  return candidates.sort((a, b) => map.FlowAccumulation[b] - map.FlowAccumulation[a]);
}
const riverAt = (map: PhysicalField, i: number) => ({
  x: map.mesh.x[i],
  y: map.mesh.y[i],
  accumulation: map.FlowAccumulation[i],
});
/** The largest river already running through the floor, if any, is the present capture. */
function heldRiver(map: PhysicalField, floor: Set<number>, record: LandmarkRecord) {
  let held = 0;
  record.capture = null;
  for (const i of floor)
    if (map.RiverOrders[i] > 0 && map.FlowAccumulation[i] > held) {
      held = map.FlowAccumulation[i];
      record.capture = riverAt(map, i);
    }
  return held;
}
export interface CaptureTarget {
  /** The cell the captured river must reach. */
  head: number;
  /** Cells that already belong to the landmark's channel. */
  floor: Set<number>;
  floorWidth: number;
  /** Metres from the head within which a river may be claimed. */
  reach: number;
  /** The landmark's name for its channel, in the record's notes. */
  label: string;
}
/**
 * Claim the largest divertible river within reach of the head. Water is never invented: if no
 * river qualifies the landmark keeps its local drainage and the record says so.
 */
export function captureInto(map: PhysicalField, record: LandmarkRecord, target: CaptureTarget) {
  if (target.head < 0) return 0;
  const { head, floor, reach } = target,
    held = heldRiver(map, floor, record),
    steps = 4 * Math.ceil(reach / map.mesh.spacing) + 8;
  if (!map.RiverOrders.some((order) => order > 0)) return 0;
  for (const best of riversNear(map, head, reach, floor)) {
    if (map.FlowAccumulation[best] <= held) break;
    if (flowsInto(map, best, floor, steps)) return 0;
    const corridor = cutCorridor(map, best, head, target.floorWidth);
    if (!corridor) continue;
    record.corridor = [...new Set([...record.corridor, ...corridor.cells])];
    record.capture = riverAt(map, best);
    note(
      record,
      `Captured the river at (${Math.round(map.mesh.x[best] + map.mesh.origin[0])}, ${Math.round(map.mesh.y[best] + map.mesh.origin[1])}) into the ${target.label}.`
    );
    return corridor.applied / 1024;
  }
  if (!record.capture)
    note(
      record,
      `No river within ${Math.round(reach / 1000)} km of the ${target.label}; it carries local drainage only.`
    );
  return 0;
}
/** The canyon claims a river at its head. */
export function captureRiver(map: PhysicalField, placed: Placed, record: LandmarkRecord) {
  const geometry = canyonCells(map, placed, record.corridor);
  return captureInto(map, record, {
    head: channelCell(map, geometry.line[0]),
    floor: new Set(geometry.floor.map((cell) => cell.i)),
    floorWidth: geometry.floorWidth,
    reach: placed.parameters.captureDistance * 1000,
    label: "canyon head",
  });
}

export const canyon: Kind = {
  emplace(map, p, placed, _epoch, record) {
    const { rims, width } = canyonCells(map, placed, record?.corridor);
    for (const { i, d } of rims)
      map.RockResistance[i] = Math.max(
        map.RockResistance[i],
        rockResistance(1000 + 2000 * clamp(1 - (d - width / 4) / (width * 0.75), 0, 1))
      );
    deepenCanyon(map, p, placed, units(placed.parameters.depth), false, record?.corridor ?? []);
  },
  measure(map, placed, record) {
    const profile = canyonProfile(map, placed, record?.corridor);
    const depths = profile.line.map((_, k) => (profile.rimLevel[k] - profile.floorLevel[k]) / 1024);
    return { depth: mean(depths) };
  },
  maintain(map, p, placed, shortfall, _epoch, record) {
    if ((shortfall.depth ?? 0) <= 0) return 0;
    return deepenCanyon(
      map,
      p,
      placed,
      units(placed.parameters.depth),
      true,
      record?.corridor ?? []
    );
  },
  capture: captureRiver,
};
