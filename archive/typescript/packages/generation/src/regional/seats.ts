import { point, type AtlasFeature } from "@atlas/domain";
import {
  generationFeature,
  generationFeatures,
  writeGenerationFeature,
} from "../generationFeatures";
import { celsius } from "./climate";
import { cellAt, distance, isContent, neighborsOf, positionOf } from "./lattice";
import { gradeSeat } from "./grading";
import { onRiver, reachAt, retainRiverCourse } from "../water/riverKeeping";
import type { PoiHostLink } from "../poi/poiContract";
import { clamp, type RegionalState, type Seat, type Situation } from "./state";

/** Slope above which a seat's own cell is not usable ground. */
export const usableSlope = 0.12;
/** Reach, as a share of the parent span, within which a seat looks for usable ground. */
// length-unit: ratio
const siteReach = 0.6;
/** An established seat's footprint, as a share of the parent span, held to this hillslope gradient. */
const seatFootprintShare = 0.12;
const seatGradient = 0.03;

/**
 * The seat operations (spec 6.3); the settlement entry's schedule calls them.
 * Known seats start at the source map's present position and retain its river-side
 * relationship. Earlier positions remain provenance, not another map's location authority.
 */
export function knownSeats(state: RegionalState): Seat[] {
  const seats: Seat[] = [];
  for (const f of generationFeatures(state, { areaId: state.regional.input.areaId })) {
    if (f.kind !== "settlement" || f.geometry.type !== "Point") continue;
    const [x, y] = f.geometry.coordinates,
      cell = cellAt(state.physical.map.mesh, x, y);
    if (cell < 0) continue;
    seats.push({
      featureId: f.id,
      cell,
      situation: riverSide(f) ? "river" : situationAt(state, cell),
      radius: seatRadius(state),
      gradient: seatGradient,
    });
  }
  return seats;
}

function riverSide(feature: AtlasFeature) {
  const link = feature.attributes.hostedBy as PoiHostLink | undefined;
  return feature.attributes.situation === "river" || link?.host === "river";
}

export function seatRadius(state: RegionalState) {
  return clamp(
    Math.round(state.physical.map.scale.cellCount(state.regional.parentSpan * seatFootprintShare)),
    1,
    3
  );
}

/** A seat's broad situation on the present surface: by the sea, by a lake, by a river, or inland. */
export function situationAt(state: RegionalState, cell: number): Situation {
  const map = state.physical.map,
    around = new Int32Array(map.mesh.stride),
    m = neighborsOf(map.mesh, cell, around),
    cells = [cell, ...around.subarray(0, m)],
    water = (kind: number) => cells.some((j) => map.WaterKindCodes.get(j) === kind);
  if (water(1)) return "coast";
  if (water(2)) return "lake";
  if (cells.some((j) => onRiver(map, j))) return "river";
  return "inland";
}

export function usableSite(state: RegionalState, i: number) {
  const map = state.physical.map;
  return (
    isContent(map.mesh, i) &&
    map.WaterKindCodes.get(i) === 0 &&
    map.Slope.get(i) <= usableSlope &&
    celsius(state, i) >= -5
  );
}

/** A captured river-side seat retains its stream's course; actual water decides whether it runs. */
export function drawChannelsToSeats(state: RegionalState) {
  for (const seat of state.regional.evidence?.seats ?? []) {
    if (seat.situation !== "river") continue;
    const feature = generationFeature(state, seat.featureId);
    if (!feature) continue;
    const hosted = feature.attributes.hostedBy as PoiHostLink | undefined,
      river = hosted?.host === "river" ? hosted.hostId : undefined,
      identity = river ?? `seat-stream:${feature.placeId ?? feature.id}`;
    // owner-direction(2026-11-12): the stream a parent's river-side town stands on continues on a finer map whatever its water there.
    retainRiverCourse(state.physical.map, seatCourse(state, seat.cell, river), identity);
  }
}

/** Prefer an adjacent owned course; otherwise submit the existing initial tree's location proposal. */
function seatCourse(state: RegionalState, cell: number, river: string | undefined) {
  const map = state.physical.map,
    mesh = map.mesh,
    around = new Int32Array(mesh.stride),
    m = neighborsOf(mesh, cell, around),
    adjacent = [cell, ...around.subarray(0, m)].find((candidate) => {
      const reach = reachAt(map, candidate);
      return reach && (!river || reach.river === river);
    });
  if (adjacent !== undefined) return [adjacent];
  const course: number[] = [];
  for (
    let at = cell;
    at >= 0 && map.WaterKindCodes.get(at) === 0;
    at = state.regional.network!.receiver[at]
  ) {
    course.push(at);
    if (reachAt(map, at)) break;
  }
  return course;
}

/**
 * Settle every seat on the derived surface. Its footprint already held the relief
 * down; if the ground under it is still not usable it moves to the best usable ground within
 * reach that keeps its broad situation, and its footprint follows. Earlier positions remain
 * provenance; the source map's current position is what its child captures.
 */
export function settleSeats(state: RegionalState) {
  for (const seat of state.regional.evidence?.seats ?? []) {
    const feature = generationFeature(state, seat.featureId);
    if (!feature || feature.geometry.type !== "Point") continue;
    const held = usableSite(state, seat.cell),
      target = held ? seat.cell : bestSite(state, seat),
      from = feature.geometry.coordinates;
    if (target !== seat.cell) {
      seat.cell = target;
      feature.geometry = point(positionOf(state.physical.map.mesh, target));
      // The relief was graded under the old site; the new one is graded where it now stands.
      gradeSeat(state, seat);
    }
    feature.attributes = {
      ...feature.attributes,
      sitedFrom: feature.attributes.sitedFrom ?? [from[0], from[1]],
      support: supportKind(state, held, target),
      situation: situationAt(state, target),
    };
    writeGenerationFeature(state, feature);
  }
}
function supportKind(state: RegionalState, held: boolean, target: number) {
  if (held) return "footprint";
  return usableSite(state, target) ? "moved" : "unsupported";
}

function bestSite(state: RegionalState, seat: Seat) {
  const map = state.physical.map,
    mesh = map.mesh,
    reach = state.regional.parentSpan * siteReach;
  let best = seat.cell,
    bestScore = -Infinity;
  for (let i = 0; i < mesh.count; i++) {
    const d = distance(mesh, seat.cell, i);
    if (d > reach || !usableSite(state, i)) continue;
    const score =
      (situationAt(state, i) === seat.situation ? 1 : 0) - map.Slope.get(i) * 10 - d / reach;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
