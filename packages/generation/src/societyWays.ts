import type { SocietyConnection } from "@atlas/domain";
import type { GenerationState } from "./process";

/**
 * Ways are made by use. Each connection remembers how many people travel it in a year, as
 * an average that forgets over a long memory: migrants along it, the hinterland's
 * town-dwellers walking to their centre, and the market traffic between the towns at its two
 * ends. A worn way is faster, so next cycle's migration, contact and political reach prefer
 * it, and use begets use: the ways people made become the roads the map shows.
 */

/** Years over which a way forgets its traffic. */
const wearMemory = 150;
/** Travel cost over which market traffic between two towns falls by e. */
const marketReach = 100000;
/** Yearly travellers between two towns, as a share of the geometric mean of their sizes. */
const marketTravel = 0.1;
/** Yearly travellers that make a way a track, a road; a highway is built, not worn (M3b). */
export const wayClasses = { track: 100, road: 1000 } as const;
/** How much faster a road is than the raw terrain: its cost falls to this share of the base. */
const roadSpeed = 0.6;

export function wayClass(link: Pick<SocietyConnection, "wear">) {
  const wear = link.wear ?? 0;
  if (wear >= wayClasses.road) return "road";
  if (wear >= wayClasses.track) return "track";
  return null;
}
/** The cost a way charges now: the base lowered by how worn it is; the sea is not worn. */
export function wornCost(link: Pick<SocietyConnection, "distance" | "wear" | "kind">) {
  if (link.kind === "sea") return link.distance;
  const worn = Math.min(1, (link.wear ?? 0) / wayClasses.road);
  return link.distance * (1 - (1 - roadSpeed) * worn);
}
/**
 * Apply a cycle's traffic to the ways: fold the cycle's yearly travellers into each way's
 * memory, then set what each way costs to travel from here on.
 */
export function wearWays(state: GenerationState, years: number) {
  const work = state.society!,
    { connections } = work.region;
  // A rebuilt connection graph starts its traffic afresh.
  const traffic =
    work.traffic?.length === connections.length
      ? work.traffic
      : new Float64Array(connections.length);
  const keep = Math.exp(-years / wearMemory);
  const towns = new Map(work.region.communities.map((c) => [c.id, c.settlement?.population ?? 0]));
  for (const [i, link] of connections.entries()) {
    const a = towns.get(link.from) ?? 0,
      b = towns.get(link.to) ?? 0;
    const market =
      a > 0 && b > 0 ? Math.sqrt(a * b) * marketTravel * Math.exp(-link.distance / marketReach) : 0;
    const yearly = traffic[i] / Math.max(1e-9, years) + market;
    link.wear = (link.wear ?? 0) * keep + yearly * (1 - keep);
    link.travelCost = wornCost(link);
  }
  work.traffic = new Float64Array(connections.length);
}
