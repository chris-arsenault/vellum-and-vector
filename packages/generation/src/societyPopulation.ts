import {
  mergePopulation,
  population,
  requireThat,
  populationGroupsSchema,
  semanticId,
  type PopulationGroup,
  type SocietyEraRecord,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { createSocietyGeography, refreshSocietySupport } from "./societyGeography";
import { societyAncestor, inheritSociety } from "./societyInheritance";
import { peopleTrait } from "./societyTraits";

export function initializePopulation(state: GenerationState, context: MapProcessContext) {
  const prior = societyAncestor(state);
  const work = createSocietyGeography(state, context);
  const people = semanticId(state.domain.world.id, "people", "residents");
  state.domain.world.entities[people] ??= {
    id: people,
    kind: "people",
    name: "Residents",
    state: "generated",
    relations: [],
    attributes: { foodDemand: 1, growth: 1, mobility: 1, divingDepth: 200 },
  };
  if (prior) {
    inheritSociety(state, prior);
    work.inherited = true;
  } else {
    for (const c of work.region.communities)
      c.groups = [
        {
          people,
          culture: null,
          languages: [],
          religions: [],
          practices: [],
          count: c.support.capacity * (0.25 + context.random() * 0.2),
        },
      ];
    applyStartingCommunities(state);
  }
  (state.domain.world.societies ??= {})[state.society!.region.areaId] = state.society!.region;
}
export function nearestCommunity(state: GenerationState, x: number, y: number) {
  let nearest = state.society!.region.communities[0],
    distance = Infinity;
  for (const c of state.society!.region.communities) {
    const d = Math.hypot(c.position.x - x, c.position.y - y);
    if (d < distance) {
      distance = d;
      nearest = c;
    }
  }
  return nearest;
}
function applyStartingCommunities(state: GenerationState) {
  for (const f of Object.values(state.domain.world.features)) {
    if (f.kind !== "settlement" || f.geometry.type !== "Point") continue;
    if (f.areaId !== state.domain.scope.areaId || f.state === "generated") continue;
    const c = nearestCommunity(state, f.geometry.coordinates[0], f.geometry.coordinates[1]);
    if (!c) continue;
    const count = Number(f.attributes.population ?? population(c));
    requireThat(
      Number.isFinite(count) && count >= 0,
      "population",
      "Population must be finite and nonnegative."
    );
    const groups = f.attributes.groups as PopulationGroup[] | undefined;
    c.groups = groups
      ? populationGroupsSchema.parse(groups)
      : c.groups.map((g) => ({ ...g, count }));
    c.name = f.name;
    c.position = { x: f.geometry.coordinates[0], y: f.geometry.coordinates[1], z: 0 };
    c.protected = f.protected;
    c.causes.push(`Authored starting community ${f.id}.`);
  }
}
export function populationTotal(state: GenerationState) {
  return state.society!.region.communities.reduce((sum, c) => sum + population(c), 0);
}
export function evolvePopulation(
  state: GenerationState,
  context: MapProcessContext,
  years: number
) {
  const work = state.society!;
  if (work.inherited) return;
  refreshSocietySupport(state);
  const record: SocietyEraRecord = {
    id: context.epochs.at(-1)?.id ?? "Settlement",
    years,
    before: populationTotal(state),
    births: 0,
    deaths: 0,
    migrated: 0,
    after: 0,
    causes: [],
  };
  growPopulation(state, years, record);
  record.migrated = migratePopulation(
    state,
    years,
    Number(context.epochs.at(-1)?.variables.mobility ?? 1)
  );
  record.after = populationTotal(state);
  record.causes.push(
    "Population responds to food, fresh water and terrain; migrants carry their joint affiliations along traversable connections."
  );
  work.region.history.push(record);
  context.recordCause({
    kind: "domain",
    process: "human.population",
    subjects: [],
    description: `${record.id}: ${Math.round(record.before)} → ${Math.round(record.after)} people; ${Math.round(record.migrated)} relocated.`,
  });
}
function growPopulation(state: GenerationState, years: number, record: SocietyEraRecord) {
  for (const c of state.society!.region.communities) {
    if (c.protected) continue;
    const before = population(c),
      capacity = c.support.capacity / Math.max(0.01, peopleTrait(state, c, "foodDemand", 1));
    const after =
      capacity > 0 && before > 0
        ? (capacity * before) /
          (before +
            (capacity - before) * Math.exp(-0.012 * peopleTrait(state, c, "growth", 1) * years))
        : before * Math.exp(-0.03 * years);
    const survivors = before * Math.exp(-years / 65);
    record.births += Math.max(0, after - survivors);
    record.deaths += before - Math.min(after, survivors);
    for (const g of c.groups) g.count *= before > 0 ? after / before : 0;
  }
}
export function migratePopulation(state: GenerationState, years: number, mobility: number) {
  const { communities, connections } = state.society!.region;
  const index = new Map(communities.map((c, i) => [c.id, i]));
  const incoming: PopulationGroup[][] = communities.map(() => []),
    fractions = communities.map(() => 0);
  const routes: { from: number; to: number; weight: number }[] = [];
  for (const link of connections) {
    const a = index.get(link.from)!,
      b = index.get(link.to)!;
    const ca = communities[a],
      cb = communities[b];
    if (ca.protected || cb.protected) continue;
    const opportunity = (i: number) =>
      communities[i].support.capacity / Math.max(1, population(communities[i]));
    const difference = Math.log1p(opportunity(b)) - Math.log1p(opportunity(a));
    const from = difference > 0 ? a : b,
      to = difference > 0 ? b : a;
    const weight = Math.abs(difference) * Math.exp(-link.travelCost / 200000);
    routes.push({ from, to, weight });
    fractions[from] += weight;
  }
  const response = 1 - Math.exp((-years * mobility) / 120);
  const outgoing = communities.map((c) => population(c)),
    moved = communities.map(() => 0);
  for (const route of routes) {
    const fraction =
      (response * Math.min(0.5, fractions[route.from]) * route.weight) /
      Math.max(1e-12, fractions[route.from]);
    moved[route.from] += fraction;
    incoming[route.to].push(
      ...communities[route.from].groups.map((g) => ({ ...g, count: g.count * fraction }))
    );
  }
  for (const [i, c] of communities.entries())
    c.groups = mergePopulation([
      ...c.groups.map((g) => ({ ...g, count: g.count * (1 - moved[i]) })),
      ...incoming[i],
    ]);
  return moved.reduce((sum, fraction, i) => sum + fraction * outgoing[i], 0);
}
