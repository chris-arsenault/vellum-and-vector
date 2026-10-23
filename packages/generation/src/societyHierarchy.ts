import {
  population,
  type SocietyCommunity,
  type SocietyRegion,
  type SocietyPolity,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import { communityDistances } from "./societyContact";

function occupied(c: SocietyCommunity) {
  return Boolean(c.founded && c.status === "inhabited" && (c.settlement?.population ?? 0) >= 20);
}
function urban(c: SocietyCommunity) {
  return Math.min(population(c), c.settlement?.population ?? 0);
}
function seatScore(c: SocietyCommunity) {
  return urban(c) + Math.sqrt(urban(c) * population(c));
}
function preferredSeat(
  region: SocietyRegion,
  polity: SocietyPolity,
  current: number,
  distance: Float64Array
) {
  const politics = region.politics!;
  const candidates = region.communities.filter(
    (c, i) =>
      occupied(c) &&
      Number.isFinite(distance[i]) &&
      (politics.control[c.id] ?? politics.sovereignty[c.id]) === polity.id
  );
  candidates.sort((a, b) => seatScore(b) - seatScore(a) || a.id.localeCompare(b.id));
  const best = candidates[0],
    prior = region.communities[current];
  if (best && prior && candidates.includes(prior) && seatScore(best) < seatScore(prior) * 1.5)
    return prior;
  return best;
}
/** Political seats follow viable towns and their reachable population, with tenure inertia. */
export function relocatePolitySeats(state: GenerationState, era: string) {
  const region = state.society!.region,
    politics = region.politics!;
  const distances = communityDistances(region);
  for (const polity of politics.polities) {
    const entity = state.domain.world.entities[polity.id];
    if (entity?.state === "authored") continue;
    const current = region.communities.findIndex((c) => c.id === polity.seat);
    const best = preferredSeat(region, polity, current, distances(current)),
      prior = region.communities[current];
    if (!best || best.id === polity.seat) continue;
    polity.causes.push(
      `${era}: the seat moved from ${prior?.name ?? "its founding site"} to ${best.name} as settlement and supporting population changed.`
    );
    polity.seat = best.id;
    if (entity) entity.attributes.center = { ...best.position };
  }
}

export interface SettlementHierarchy {
  settlementRole: "capital" | "regionalCapital" | "marketTown" | "settlement";
  polityId: string | null;
  capitalOf: string[];
}
/** Market prominence follows inhabited neighbors over traversable travel distance. */
export function settlementHierarchy(region: SocietyRegion): Map<string, SettlementHierarchy> {
  const result = new Map<string, SettlementHierarchy>();
  const politics = region.politics;
  for (const c of region.communities)
    result.set(c.id, {
      settlementRole: "settlement",
      polityId: politics?.control[c.id] ?? null,
      capitalOf: [],
    });
  markCapitals(region, result);
  markRegionalCenters(region, result);
  return result;
}
function markCapitals(region: SocietyRegion, result: Map<string, SettlementHierarchy>) {
  const politics = region.politics;
  for (const polity of politics?.polities ?? []) {
    const c = region.communities.find((c) => c.id === polity.seat);
    if (
      !c ||
      !occupied(c) ||
      polity.status === "collapsed" ||
      politics!.control[c.id] !== polity.id
    )
      continue;
    const role = result.get(c.id)!;
    role.settlementRole = "capital";
    role.capitalOf.push(polity.id);
  }
}
function markRegionalCenters(region: SocietyRegion, result: Map<string, SettlementHierarchy>) {
  const politics = region.politics;
  const distances = communityDistances(region);
  const occupiedIndices = region.communities.flatMap((c, i) => (occupied(c) ? [i] : []));
  for (const i of occupiedIndices) {
    const c = region.communities[i],
      role = result.get(c.id)!;
    if (role.settlementRole === "capital" || urban(c) < 500) continue;
    const distance = distances(i);
    const neighbors = occupiedIndices.filter(
      (j) =>
        j !== i &&
        distance[j] <= 150000 &&
        (politics?.control[region.communities[j].id] ?? null) === role.polityId
    );
    // A center serves other settlements; isolated outposts are not regional capitals.
    if (
      neighbors.length < 2 ||
      neighbors.some((j) => {
        const other = region.communities[j];
        return (
          result.get(other.id)!.capitalOf.length > 0 ||
          urban(other) > urban(c) ||
          (urban(other) === urban(c) && other.id.localeCompare(c.id) < 0)
        );
      })
    )
      continue;
    role.settlementRole = role.polityId ? "regionalCapital" : "marketTown";
  }
}
