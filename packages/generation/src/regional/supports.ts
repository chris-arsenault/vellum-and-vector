import { point, gridPosition, type AtlasFeature } from "@atlas/domain";
import { writeGenerationFeature } from "../generationFeatures";
import { rankSites, type SiteOpportunity } from "../societySites";
import { channel, distance, neighbors, spacing, type RegionalState, type Support } from "./state";

/** Slope above which a seat's own cell is not usable ground. */
export const usableSlope = 0.12;
/** Reach, as a share of the parent span, within which a seat looks for a better local site. */
const siteReach = 0.6;
/** Share of a terrace footprint's departure from its level that remains after shaping. */
const terraceRelief = 0.15;
/** Ramp cells beyond the terrace edge whose slope is limited for access. */
const rampLength = 4;
const rampSlope = 0.08;

/**
 * Settlement-support realization (spec 6.3). An established seat keeps its identity and its
 * broad situation; its local coordinates and surroundings develop. First it takes a nearby
 * opportunity consistent with that situation; failing that, a bounded terrace with an access
 * ramp is shaped into the terrain. Supports are working structures: later rounds update
 * them against the evolving surface instead of stamping them again.
 */
export function realizeSupports(
  state: RegionalState,
  seats: { feature: AtlasFeature; cell: number }[],
  sites: (SiteOpportunity | null)[]
) {
  const g = state.surface,
    known = new Map(state.supports.map((support) => [support.featureId, support]));
  for (const seat of seats) {
    const existing = known.get(seat.feature.id);
    // A found site that later relief made unusable is re-evaluated; a terrace is kept.
    if (existing && (existing.kind === "terrace" || usableSite(state, existing.cell))) continue;
    if (existing) state.supports.splice(state.supports.indexOf(existing), 1);
    const support = settle(state, seat, sites);
    state.supports.push(support);
    const from = (seat.feature.geometry as GeoJSON.Point).coordinates;
    if (support.cell !== seat.cell) {
      const p = gridPosition(g, support.cell);
      seat.feature.geometry = point(p);
      seat.cell = support.cell;
    }
    seat.feature.attributes = {
      ...seat.feature.attributes,
      sitedFrom: seat.feature.attributes.sitedFrom ?? [from[0], from[1]],
      support: support.kind,
      ...(sites[support.cell]
        ? { siteKind: sites[support.cell]!.kind, siteReason: sites[support.cell]!.reason }
        : {}),
    };
    writeGenerationFeature(state, seat.feature);
  }
  applySupports(state);
}

function settle(
  state: RegionalState,
  seat: { feature: AtlasFeature; cell: number },
  sites: (SiteOpportunity | null)[]
): Support {
  const g = state.surface,
    [dx, dy] = spacing(g),
    reach = state.parentSpan * siteReach,
    rx = Math.ceil(reach / dx),
    ry = Math.ceil(reach / dy),
    cx = seat.cell % g.width,
    cy = Math.floor(seat.cell / g.width),
    near = waterNear(state, seat.cell, rx, ry),
    broad = situation(state, seat.cell, near);
  let best = -1,
    bestScore = -Infinity,
    flattest = seat.cell,
    flattestSlope = Infinity;
  for (let y = Math.max(0, cy - ry); y <= Math.min(g.height - 1, cy + ry); y++)
    for (let x = Math.max(0, cx - rx); x <= Math.min(g.width - 1, cx + rx); x++) {
      const i = y * g.width + x,
        d = distance(g, seat.cell, i);
      if (d > reach || g.channels.water.get(i) !== 0) continue;
      const slope = g.channels.slope.get(i);
      if (d <= reach / 2 && slope < flattestSlope) {
        flattestSlope = slope;
        flattest = i;
      }
      if (!usableSite(state, i)) continue;
      const site = sites[i],
        score =
          (site ? 3 - 0.2 * Math.min(10, siteRank(site)) + site.score : 0) +
          (situation(state, i, near) === broad ? 1 : 0) -
          slope * 20 -
          d / reach;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  if (best >= 0) return { featureId: seat.feature.id, cell: best, kind: "site" };
  // No usable ground within reach: the local conditions that made settlement possible are
  // represented as a terrace on the flattest nearby ground, with access shaped below it.
  const level = g.channels.elevation.get(flattest),
    radius = 2;
  return {
    featureId: seat.feature.id,
    cell: flattest,
    kind: "terrace",
    level,
    radius,
    footprint: terraceForm(state, flattest, radius, level),
  };
}

/**
 * The fixed form of a terrace: its footprint cells drawn toward the level, a softened rim,
 * and the access ramp below it with each step's slope limited. Fixed once so that applying
 * the form again restores the terrace instead of cutting or filling further.
 */
function terraceForm(state: RegionalState, center: number, radius: number, level: number) {
  const g = state.surface,
    h = g.channels.elevation,
    [dx, dy] = spacing(g),
    cx = center % g.width,
    cy = Math.floor(center / g.width),
    form = new Map<number, number>();
  for (let y = Math.max(0, cy - radius - 1); y <= Math.min(g.height - 1, cy + radius + 1); y++)
    for (let x = Math.max(0, cx - radius - 1); x <= Math.min(g.width - 1, cx + radius + 1); x++) {
      const cell = y * g.width + x;
      if ((g.channels.water?.get(cell) ?? 0) !== 0) continue;
      const d = Math.hypot((x - cx) * dx, (y - cy) * dy) / Math.min(dx, dy),
        share = d <= radius ? terraceRelief : d <= radius + 1 ? 0.55 : 1;
      if (share < 1) form.set(cell, level + (h.get(cell) - level) * share);
    }
  // The ramp follows the steepest descent from the terrace edge over the shaped heights.
  const at = (cell: number) => form.get(cell) ?? h.get(cell);
  let current = center;
  for (let step = 0; step < radius + rampLength; step++) {
    let next = -1,
      lowest = at(current);
    for (const j of neighbors(g, current))
      if ((g.channels.water?.get(j) ?? 0) === 0 && at(j) < lowest) {
        lowest = at(j);
        next = j;
      }
    if (next < 0) break;
    const drop = at(current) - at(next),
      limit = rampSlope * distance(g, current, next);
    if (step >= radius && drop > limit) form.set(next, at(current) - limit);
    current = next;
  }
  return [...form].map(([cell, height]) => ({ cell, height }));
}

function siteRank(site: SiteOpportunity) {
  return [
    "pass",
    "fire-seat",
    "river-node",
    "harbour",
    "door-house",
    "sanctuary",
    "melt-line",
    "fishery-coast",
    "halo-edge",
    "healing-well",
    "necropolis",
    "plain-node",
    "plain",
  ].indexOf(site.kind);
}

export function usableSite(state: RegionalState, i: number) {
  const c = state.surface.channels;
  return (
    (c.water?.get(i) ?? 0) === 0 &&
    c.slope.get(i) <= usableSlope &&
    (c.temperature?.get(i) ?? 15) >= -5
  );
}

/** Surface water within the search window, for keeping a seat's broad situation. */
function waterNear(state: RegionalState, cell: number, rx: number, ry: number) {
  const g = state.surface,
    cx = cell % g.width,
    cy = Math.floor(cell / g.width);
  for (let y = Math.max(0, cy - ry); y <= Math.min(g.height - 1, cy + ry); y++)
    for (let x = Math.max(0, cx - rx); x <= Math.min(g.width - 1, cx + rx); x++) {
      const i = y * g.width + x;
      if ((g.channels.water?.get(i) ?? 0) !== 0 || (g.channels.riverOrder?.get(i) ?? 0) > 0)
        return true;
    }
  return false;
}
/** A seat's broad situation: by the sea, by a river, or inland. */
function situation(state: RegionalState, i: number, waterNearby: boolean) {
  const g = state.surface;
  let coast = false,
    river = (g.channels.riverOrder?.get(i) ?? 0) > 0;
  for (const j of neighbors(g, i)) {
    coast ||= g.channels.water?.get(j) === 1;
    river ||= (g.channels.riverOrder?.get(j) ?? 0) > 0;
  }
  return coast ? "coast" : river ? "river" : waterNearby ? "near-water" : "inland";
}

/**
 * Shape every terrace to its stored form and limit the slope of the ramp below it. The
 * form is fixed when the terrace is made, so applying it again after erosion restores the
 * terrace rather than cutting it deeper.
 */
export function applySupports(state: RegionalState) {
  const g = state.surface,
    h = g.channels.elevation,
    sediment = channel(state, "sediment", "metre");
  for (const support of state.supports) {
    if (support.kind !== "terrace") continue;
    for (const { cell, height } of support.footprint ?? []) {
      sediment.add(cell, Math.max(0, height - h.get(cell)));
      h.set(cell, height);
    }
  }
}

/** Usable ground around seats after the schedule, for checks and for place publication. */
export function seatSites(state: RegionalState) {
  return rankSites(state);
}
