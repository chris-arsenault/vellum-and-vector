import {
  CellList,
  gridPosition,
  neighbors,
  population,
  societyWorkNatures,
  spatial,
  type SocietyCommunity,
  type SocietyDemand,
  type SocietyWork,
  type SocietyWorkKind,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import { dryLand, societyValue } from "./societySupport";
import { isWorldSociety } from "./societyMapScope";

/**
 * Society as field forcing (ADR 0005). At World a unit's works are demands it makes of its
 * country, not earthworks at a point. An intensive demand acts over the unit's cells of the
 * kind's medium with the total the located work would have had. A structural demand (dam,
 * harbour, pass, weir) is one thing or none: at World it carries an amount and a unit and
 * does nothing; a finer profile realizes it at a site on its own medium.
 */

/**
 * The cells of a unit's country a demand acts on: a dam or irrigation on its rivers, a
 * harbour or weir on its shore, tapping on its veins, quarrying on its prisms, a pass on
 * its steep ground, and clearance, burning, hunting and conservation on all its land.
 */
export function workMedium(state: GenerationState, kind: SocietyWorkKind) {
  const v = (name: string, i: number) => societyValue(state, name, i);
  switch (kind) {
    case "dam":
    case "irrigation":
      return (i: number) => state.society!.river[i] > 0.2 || v("riverOrder", i) >= 1;
    case "harbor":
    case "weir":
      return (i: number) => state.society!.coast[i] > 0;
    case "tapping":
      return (i: number) => v("magic:fire:intensity", i) >= 100;
    case "quarrying":
      return (i: number) => v("magic:aurora:feature:prism", i) > 0;
    case "pass":
      return (i: number) => v("slope", i) > 0.08;
    default:
      return () => true;
  }
}
/** The dry cells of the work's country (its unit, or the heirs of an inherited unit) that carry its medium. */
function* mediumCells(
  state: GenerationState,
  work: Pick<SocietyWork, "communityId" | "kind"> & { country?: string[] }
) {
  const society = state.society!,
    ids = new Set(work.country ?? [work.communityId]),
    units = new Set(
      society.region.communities.flatMap((c, index) => (ids.has(c.id) ? [index] : []))
    ),
    medium = workMedium(state, work.kind);
  if (!units.size) return;
  for (let i = 0; i < society.owner.length; i++)
    if (units.has(society.owner[i]) && dryLand(state, i) && medium(i)) yield i;
}
/** The share of the unit's medium a located work of this radius would have covered. */
function mediumShare(area: number, radius: number) {
  return area > 0 ? Math.min(1, (Math.PI * radius ** 2) / area) : 0;
}
export function isStructural(kind: SocietyWorkKind) {
  return societyWorkNatures[kind].nature === "structural";
}
/** Whether the unit holds any cell of the kind's medium. */
export function hasMedium(state: GenerationState, work: Pick<SocietyWork, "communityId" | "kind">) {
  return !mediumCells(state, work).next().done;
}
/** The channel cell a World dam demand would stand on: the unit's river cell with the most flow. */
export function damCandidateCell(state: GenerationState, work: SocietyWork) {
  let best = -1,
    flow = -Infinity;
  for (const i of mediumCells(state, work)) {
    const f = societyValue(state, "flow", i);
    if (f > flow) [best, flow] = [i, f];
  }
  return best;
}
/**
 * What the unit demands, in the kind's unit, from its own country: the share of its medium
 * for intensive kinds, the flux it would divert or regulate for water works, the people a
 * harbour or pass would serve, the shore a weir would work.
 */
export function demandAmount(
  state: GenerationState,
  c: SocietyCommunity,
  kind: SocietyWorkKind,
  radius: number
): SocietyDemand {
  const unit = societyWorkNatures[kind].unit,
    { area, flow, maximum, shore } = mediumTotals(state, c.id, kind),
    share = mediumShare(area, radius);
  switch (kind) {
    case "irrigation":
    case "dam": {
      // The same fifth of a channel's flow that a located water work may take.
      const amount = kind === "dam" ? maximum : flow * share;
      return { amount, unit };
    }
    case "harbor":
    case "pass":
      return { amount: population(c), unit };
    case "weir":
      return { amount: shore * share, unit };
    default:
      return { amount: share, unit };
  }
}
function mediumTotals(state: GenerationState, communityId: string, kind: SocietyWorkKind) {
  let area = 0,
    flow = 0,
    maximum = 0,
    shore = 0;
  for (const i of mediumCells(state, { communityId, kind })) {
    area += state.surface.measures[i];
    if (kind === "irrigation" || kind === "dam") {
      const amount = societyValue(state, "flow", i) * 0.2;
      flow += amount;
      maximum = Math.max(maximum, amount);
    }
    if (kind === "weir") shore += Math.sqrt(state.surface.measures[i]);
  }
  return { area, flow, maximum, shore };
}
/**
 * An intensive demand's samples: every medium cell of its unit, each at the share a located
 * work of the same radius would have covered, so the total forcing is conserved and spread.
 * A structural demand has no samples: a fraction of a dam is nothing.
 */
export function* demandSamples(state: GenerationState, work: SocietyWork) {
  if (isStructural(work.kind)) return;
  // Capture eligibility before applying the work: its effects can change the medium.
  const cells = new CellList();
  let area = 0;
  for (const i of mediumCells(state, work)) {
    cells.push(i);
    area += state.surface.measures[i];
  }
  const fraction = mediumShare(area, work.radius);
  if (fraction <= 0) return;
  for (let k = 0; k < cells.length; k++) yield { i: cells.at(k), fraction };
}
/**
 * How well a cell of the medium serves a structural work on this profile's terrain: a dam
 * wants the strongest channel between the highest banks, a harbour a sheltered shore with
 * deep water beside it and no Pressure surge, a pass a col, a weir shallow water off the
 * shore. Zero where the cell offers nothing beyond being medium.
 */
export function siteQuality(state: GenerationState, kind: SocietyWorkKind, i: number) {
  const grid = state.surface,
    ring = neighbors(grid, i, true, spatial.geometryCoverage(grid.scope.footprint)),
    v = (name: string, j: number) => societyValue(state, name, j),
    own = v("elevation", i),
    sea = ring.filter((j) => v("water", j) === 1);
  switch (kind) {
    case "dam":
      return damQuality(v, ring, own, v("flow", i));
    case "harbor":
      return harbourQuality(v, sea);
    case "pass":
      return passQuality(v, ring, own);
    case "weir":
      return sea.some((j) => v("waterDepth", j) < 30) ? 1 : 0;
    default:
      return 0;
  }
}
type Read = (name: string, j: number) => number;
/** The strongest channel between the highest banks: the mean rise of the ring above the bed. */
function damQuality(v: Read, ring: number[], bed: number, flow: number) {
  const rise = ring.reduce((sum, j) => sum + Math.max(0, v("elevation", j) - bed), 0);
  const banks = ring.length ? rise / ring.length : 0;
  return Math.log1p(Math.max(0, flow)) * (1 + banks / 100);
}
/** Shelter (few sea neighbours), deep water beside the shore, no Pressure surge. */
function harbourQuality(v: Read, sea: number[]) {
  if (!sea.length) return 0;
  const shelter = sea.length <= 3 ? 1 : sea.length <= 4 ? 0.6 : 0.2,
    depth = Math.max(...sea.map((j) => v("waterDepth", j))) >= 10 ? 1 : 0.4,
    surge = Math.max(...sea.map((j) => v("magic:pressure:intensity", j))) >= 400 ? 0.3 : 1;
  return shelter * depth * surge;
}
/** A col: the ring alternates high and low at least twice, with relief both ways. */
function passQuality(v: Read, ring: number[], own: number) {
  let changes = 0;
  for (let k = 0; k < ring.length; k++) {
    const here = v("elevation", ring[k]) > own,
      next = v("elevation", ring[(k + 1) % ring.length]) > own;
    if (here !== next) changes++;
  }
  const rise = Math.max(0, ...ring.map((j) => v("elevation", j) - own)),
    drop = Math.max(0, ...ring.map((j) => own - v("elevation", j)));
  return changes >= 4 ? Math.min(rise, drop) : 0;
}
/** The medium cell this profile's terrain makes the best site for the work, the seat breaking ties. */
function bestSite(state: GenerationState, work: SocietyWork, seat: SocietyCommunity["position"]) {
  const grid = state.surface;
  let best = -1,
    quality = -Infinity,
    distance = Infinity;
  for (const i of mediumCells(state, work)) {
    const p = gridPosition(grid, i),
      d = Math.hypot(p.x - seat.x, p.y - seat.y),
      q = siteQuality(state, work.kind, i);
    if (q > quality || (q === quality && d < distance)) [best, quality, distance] = [i, q, d];
  }
  return { cell: best, quality, distance };
}
/**
 * At a profile finer than World, each inherited demand becomes a located work on the cell of
 * its medium that this profile's terrain makes the best site, the seat breaking ties; the
 * work is marked as realized here so the present applies it. A demand with no medium in the
 * refined area stays a demand with its whole amount recorded as unmet (ADR 0005).
 */
export function realizeDemands(state: GenerationState) {
  if (isWorldSociety(state)) return;
  const area = state.domain.scope.areaId;
  for (const work of state.society!.region.works) {
    if (!work.demand) continue;
    const c = state.society!.region.communities.find((c) => c.id === work.communityId);
    if (!c) continue;
    const site = bestSite(state, work, c.position);
    if (site.cell < 0) {
      work.demand.unmet = work.demand.amount;
      continue;
    }
    const { amount, unit } = work.demand;
    work.position = gridPosition(state.surface, site.cell);
    // The heir whose land holds the site owns the work.
    work.communityId = state.society!.region.communities[state.society!.owner[site.cell]].id;
    work.applied = 0;
    work.realizedAt = area;
    delete work.demand;
    delete work.country;
    work.causes.push(
      `Realized at this profile: the ${work.kind} the unit demanded (${amount.toFixed(2)} ${unit}) is located on the ${site.quality > 0 ? "best" : "nearest"} cell of its medium, ${Math.round(site.distance / 1000)} km from its seat.`
    );
  }
}
/** The kinds a World unit demands of its country, for its published record. */
export function demandedKinds(state: GenerationState, communityId: string) {
  return state
    .society!.region.works.filter((w) => w.demand && w.communityId === communityId)
    .map((w) => w.kind)
    .sort();
}
