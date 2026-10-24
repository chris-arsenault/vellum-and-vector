import {
  gridPosition,
  population,
  type SocietyCommunity,
  type SocietyWork,
  type SocietyWorkKind,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import { societyValue } from "./societySupport";
import { isWorldSociety } from "./societyMapScope";
import { hasMedium } from "./societyDemand";
import { nearestSample, samplesInBox } from "./societySpatial";

/**
 * The cold-age set of a mobile round: hunt the crowded herds, burn the groves open, dig into
 * the veins, quarry the prisms, build weirs in the bays. Small bands do all of it.
 */
export function coldAgeWorks(state: GenerationState, c: SocietyCommunity): SocietyWorkKind[] {
  if (population(c) < 40) return [];
  const i = nearestSample(state, c.position),
    v = (name: string) => societyValue(state, name, i);
  const kinds: SocietyWorkKind[] = [];
  if (v("herbivores") > 0.001) kinds.push("hunting");
  if (v("treeCover") > 0.25) kinds.push("burning");
  // At World a band works the veins, prisms and shore its own unit holds; a finer profile
  // looks for the site within a day's reach of the camp (ADR 0005).
  const reaches = (kind: SocietyWorkKind, channel: string, threshold: number, reach: number) =>
    isWorldSociety(state)
      ? hasMedium(state, { communityId: c.id, kind })
      : coldAgeSite(state, c, channel, threshold, reach) >= 0;
  if (reaches("tapping", "magic:fire:intensity", 100, 25_000)) kinds.push("tapping");
  if (reaches("quarrying", "magic:aurora:feature:prism", 1, 30_000)) kinds.push("quarrying");
  const shore = isWorldSociety(state)
    ? hasMedium(state, { communityId: c.id, kind: "weir" })
    : state.society!.coast[i] > 0;
  if (shore && population(c) >= 100) kinds.push("weir");
  return kinds;
}
/** The nearest sample within reach where a channel reaches a threshold, or -1. */
function coldAgeSite(
  state: GenerationState,
  c: SocietyCommunity,
  channel: string,
  threshold: number,
  reach: number,
  accepts: (i: number) => boolean = () => true
) {
  const { x, y } = c.position;
  let best = -1,
    distance = reach;
  for (const i of samplesInBox(state.surface, [x - reach, y - reach, x + reach, y + reach])) {
    if (societyValue(state, channel, i) < threshold || !accepts(i)) continue;
    const p = gridPosition(state.surface, i),
      d = Math.hypot(p.x - x, p.y - y);
    if (d < distance) [best, distance] = [i, d];
  }
  return best;
}
/** Where a located cold-age work stands: the vein, the prism ridge, the shallow water of the bay. */
export function placeColdAgeWork(state: GenerationState, c: SocietyCommunity, work: SocietyWork) {
  const grid = state.surface;
  const at =
    work.kind === "tapping"
      ? coldAgeSite(state, c, "magic:fire:intensity", 100, 25_000)
      : work.kind === "quarrying"
        ? coldAgeSite(state, c, "magic:aurora:feature:prism", 1, 30_000)
        : work.kind === "weir"
          ? coldAgeSite(
              state,
              c,
              "water",
              1,
              15_000,
              (i) => societyValue(state, "waterDepth", i) < 30
            )
          : -1;
  if (at >= 0) work.position = gridPosition(grid, at);
}
