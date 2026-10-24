import { population, languageUse, type SocietyCommunity } from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { communityName } from "./societyNaming";
import { nearestSample } from "./societySpatial";
import { dryLand } from "./societySupport";

/** Founders occupy a subset of suitable country. Empty catchments remain destinations. */
export function startingPopulations(state: GenerationState, context: MapProcessContext) {
  const communities = state.society!.region.communities;
  const counts = communities.map((c) => {
    const density = c.support.capacity / Math.max(1, c.areaKm2);
    const chance = 0.2 * (1 - Math.exp(-density / 5));
    return context.random() < chance ? c.support.capacity * (0.04 + 0.2 * context.random()) : 0;
  });
  // A viable map gets a source population even when its small sample misses the draw.
  if (!counts.some((n) => n > 0)) {
    const best = communities.reduce(
      (a, c, i) => (c.support.capacity > (communities[a]?.support.capacity ?? 0) ? i : a),
      -1
    );
    if (best >= 0) counts[best] = communities[best].support.capacity * 0.12;
  }
  return counts;
}

function contactPopulation(state: GenerationState) {
  const region = state.society!.region;
  const communities = new Map(region.communities.map((c) => [c.id, c]));
  const contact = new Map<string, number>();
  for (const route of region.connections) {
    const a = communities.get(route.from)!,
      b = communities.get(route.to)!;
    const access = Math.exp(-route.travelCost / 50000);
    contact.set(a.id, (contact.get(a.id) ?? 0) + population(b) * access);
    contact.set(b.id, (contact.get(b.id) ?? 0) + population(a) * access);
  }
  return contact;
}

/** Residents a site draws beyond its farmland: a Fire core seats a large town, a pass or harbour a market. */
function siteDraw(c: SocietyCommunity) {
  const kind = c.site?.kind;
  if (kind === "fire-seat") return 0.12;
  if (kind === "pass" || kind === "harbour") return 0.03;
  return 0;
}
function concentration(c: SocietyCommunity, contacts: number) {
  const people = population(c);
  const farming = c.support.farming / Math.max(1, c.support.capacity);
  const density = people / Math.max(1, people + c.areaKm2 * 2);
  const market = contacts / Math.max(1, people + contacts);
  // Local surplus and reachable customers support residents outside primary production.
  return people * density * (0.025 + siteDraw(c) + 0.2 * farming * market + 0.06 * c.support.water);
}

function updateOccupation(c: SocietyCommunity, target: number, years: number, label: string) {
  if (c.protected) return;
  const settlement = (c.settlement ??= { population: 0, peak: 0, recoveryYears: 0 });
  const before = c.status;
  settlement.population = Math.min(
    population(c),
    Math.max(
      0,
      settlement.population + (target - settlement.population) * (1 - Math.exp(-years / 30))
    )
  );
  settlement.peak = Math.max(settlement.peak, settlement.population);
  updateStatus(c, years);
  if (before !== c.status)
    c.causes.push(
      `${label}: ${before} → ${c.status}; ${Math.round(population(c))} residents supported by local livelihoods and reachable communities.`
    );
}
function updateStatus(c: SocietyCommunity, years: number) {
  const settlement = c.settlement!;
  if (c.status === "ruined") {
    const viable = c.support.capacity >= population(c) && settlement.population >= 80;
    settlement.recoveryYears = viable ? settlement.recoveryYears + years : 0;
    if (settlement.recoveryYears >= 30) c.status = "inhabited";
  } else if (settlement.population >= 80) c.status = "inhabited";
  else if (settlement.population < 20) c.status = "abandoned";
}

export function evolveSettlements(
  state: GenerationState,
  context: MapProcessContext,
  years: number
) {
  if (state.society!.inherited) return;
  const contact = contactPopulation(state);
  const era = context.epochs.at(-1)?.id ?? "Settlement";
  const year = state.society!.cycle?.elapsed ?? years;
  for (const c of state.society!.region.communities) {
    const label = `${era}, year ${year}`;
    if (dryLand(state, nearestSample(state, c.position)))
      updateOccupation(c, concentration(c, contact.get(c.id) ?? 0), years, label);
    else inundateSettlement(c, label);
    establishSettlement(state, c, `${era}, year ${year}`);
    recordOccupation(c, era, year);
  }
}
function inundateSettlement(c: SocietyCommunity, label: string) {
  if (c.protected || !c.settlement) return;
  if (c.settlement.population > 0)
    c.causes.push(
      `${label}: the settlement site became water; survivors dispersed into its surrounding catchment.`
    );
  c.settlement.population = 0;
  if (c.founded) c.status = "abandoned";
}
function establishSettlement(state: GenerationState, c: SocietyCommunity, label: string) {
  if (c.founded || c.status !== "inhabited" || c.protected) return;
  c.founded = label;
  const named = communityName(state.domain.world, c, label);
  c.name = named.name;
  c.naming = { language: named.namingLanguage, culture: named.namingCulture, era: label };
}
function recordOccupation(c: SocietyCommunity, era: string, year: number) {
  (c.history ??= []).push({
    era,
    year,
    population: population(c),
    capacity: c.support.capacity,
    settlementPopulation: c.settlement?.population ?? 0,
    status: c.status,
    languageUse: languageUse(c.groups),
  });
}
