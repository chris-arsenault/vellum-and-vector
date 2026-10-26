import { population, spatial, type SocietyCommunity, type SocietyConnection } from "@atlas/domain";
import type { GenerationState } from "./process";
import { communityName } from "./societyNaming";
import { concentration, communityContacts } from "./societySettlements";
import { nearestSocietySample } from "./societySpatial";
import { dryLand } from "./societySupport";
import { wornCost } from "./societyWays";

/** Compatibility for maps created before local-town allocations were retained. */
export function unresolvedTownResidents(c: SocietyCommunity, contacts = 0) {
  return Math.min(
    Math.max(0, population(c) - (c.settlement?.population ?? 0)),
    c.latentSettlementPopulation ?? concentration(c, contacts) * 0.15
  );
}

/** A concentration is a subset of existing residents, with no elapsed demographic step. */
export function realizeRegionalPlaces(state: GenerationState) {
  const region = state.society!.region;
  for (const c of region.communities) {
    if (!canRevealTown(c)) continue;
    const cell = nearestSocietySample(state.surface, c.position, (i) => dryLand(state, i));
    if (cell < 0) continue;
    const residents = Math.min(population(c), c.latentSettlementPopulation ?? 0);
    const era = region.history.at(-1)?.id ?? "Inherited settlement";
    const named = communityName(state.domain.world, c, era);
    c.name = named.name;
    c.naming = { language: named.namingLanguage, culture: named.namingCulture, era };
    c.founded = `Existing settlement revealed from ${era}`;
    c.status = "inhabited";
    c.settlement = { population: residents, peak: residents, recoveryYears: 0 };
    c.latentSettlementPopulation = Math.max(0, (c.latentSettlementPopulation ?? 0) - residents);
    c.causes.push(
      "Local town residents resolved at an inherited geographic opportunity; no population or years added."
    );
  }
}
/** The existing occupation model uses eighty residents for an inhabited mapped town. */
const minimumMappedTown = 80;
function canRevealTown(c: SocietyCommunity) {
  return (
    !c.founded &&
    !!c.parentCommunity &&
    !c.protected &&
    Math.min(population(c), c.latentSettlementPopulation ?? 0) >= minimumMappedTown &&
    !!c.site &&
    c.site.kind !== "plain" &&
    c.support.capacity > 0
  );
}

export function regionalCommunitySpacing(
  state: GenerationState,
  retained: SocietyCommunity[] = []
) {
  const grid = state.surface;
  const nominal = { world: 100000, region: 25000, local: 2500, site: 250, interior: 25 }[
    state.domain.world.areas[state.domain.scope.areaId].profile
  ];
  const territories = retained.filter(
    (c) => c.footprint && spatial.intersects(c.footprint, grid.scope.footprint)
  );
  const inherited = territories.length
    ? Math.sqrt(
        territories.reduce((sum, c) => sum + spatial.area(c.footprint!), 0) / territories.length
      ) / 3
    : nominal;
  return Math.min(
    nominal,
    inherited,
    Math.max(grid.bounds[2] - grid.bounds[0], grid.bounds[3] - grid.bounds[1]) / 3
  );
}

export function localTownAllocations(
  communities: SocietyCommunity[],
  connections: SocietyConnection[]
) {
  const contacts = communityContacts({ communities, connections });
  return new Map(communities.map((c) => [c.id, unresolvedTownResidents(c, contacts.get(c.id))]));
}

/** Keep historically meaningful alternatives, including sea and door links beside a land way. */
export function retainRegionalConnections(
  current: SocietyConnection[],
  previous: SocietyConnection[],
  ids: Set<string>
) {
  const key = (link: SocietyConnection) => `${[link.from, link.to].sort().join(":")}:${link.kind}`;
  const links = new Map(current.map((link) => [key(link), link]));
  for (const old of previous) {
    if (!ids.has(old.from) || !ids.has(old.to)) continue;
    const candidate = links.get(key(old));
    const link = { ...structuredClone(old), distance: candidate?.distance ?? old.distance };
    link.travelCost = wornCost(link);
    links.set(key(old), link);
  }
  return [...links.values()];
}

/** Existing seats are fixed inputs, before unresolved new sites claim territory. */
export function retainedSeatCells(state: GenerationState, communities: SocietyCommunity[] = []) {
  const covered = spatial.pointCoverage(state.domain.scope.footprint);
  return [
    ...new Set(
      communities.flatMap((c) => {
        if (!c.founded || !covered(c.position)) return [];
        const cell = nearestSocietySample(state.surface, c.position, (i) => dryLand(state, i));
        return cell < 0 ? [] : [cell];
      })
    ),
  ];
}
