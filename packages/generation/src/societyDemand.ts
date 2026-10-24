import { gridPosition, type SocietyWork, type SocietyWorkKind } from "@atlas/domain";
import type { GenerationState } from "./process";
import { dryLand, societyValue } from "./societySupport";
import { isWorldSociety } from "./societyMapScope";

/**
 * Society as field forcing. At World a unit's works are demands it makes of its country,
 * not earthworks at a point: a demand acts over the unit's cells of the kind's medium with
 * the total the located work would have had. A finer profile realizes each inherited
 * demand at the nearest cell of that medium, where it becomes a located work.
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
/** The dry cells of the work's unit that carry its medium. */
function mediumCells(state: GenerationState, work: SocietyWork) {
  const society = state.society!,
    unit = society.region.communities.findIndex((c) => c.id === work.communityId),
    medium = workMedium(state, work.kind),
    cells: number[] = [];
  if (unit < 0) return cells;
  for (let i = 0; i < society.owner.length; i++)
    if (society.owner[i] === unit && dryLand(state, i) && medium(i)) cells.push(i);
  return cells;
}
/**
 * A demand's samples: every medium cell of its unit, each at the share a located work of
 * the same radius would have covered, so the total forcing is conserved and spread.
 */
export function demandSamples(state: GenerationState, work: SocietyWork) {
  const cells = mediumCells(state, work),
    area = cells.reduce((sum, i) => sum + state.surface.measures[i], 0);
  if (area <= 0) return [];
  const fraction = Math.min(1, (Math.PI * work.radius ** 2) / area);
  return cells.map((i) => ({ i, fraction }));
}
/**
 * At a profile finer than World, each inherited demand becomes a located work at the
 * nearest cell of its medium inside its unit; a demand with no medium here stays a demand.
 */
export function realizeDemands(state: GenerationState) {
  if (isWorldSociety(state)) return;
  const grid = state.surface;
  for (const work of state.society!.region.works) {
    if (!work.demand) continue;
    const c = state.society!.region.communities.find((c) => c.id === work.communityId);
    if (!c) continue;
    let best = -1,
      nearest = Infinity;
    for (const i of mediumCells(state, work)) {
      const p = gridPosition(grid, i),
        d = Math.hypot(p.x - c.position.x, p.y - c.position.y);
      if (d < nearest) [best, nearest] = [i, d];
    }
    if (best < 0) continue;
    work.position = gridPosition(grid, best);
    work.applied = 0;
    delete work.demand;
    work.causes.push(
      `Realized at this profile: the ${work.kind} the unit demanded of its country is located on the nearest ${work.kind === "harbor" || work.kind === "weir" ? "shore" : "medium"} cell, ${Math.round(nearest / 1000)} km from its seat.`
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
