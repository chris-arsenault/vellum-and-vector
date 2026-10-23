import {
  mergePopulation,
  population,
  semanticId,
  type Entity,
  type PopulationGroup,
  type Position,
  type SocietyCommunity,
} from "@atlas/domain";
import type { GenerationState, MapProcess, MapProcessContext } from "./process";
import { centers } from "./mapPeople";
import { initializePopulation, nearestCommunity } from "./societyPopulation";
import { communityReach } from "./societyContact";
import { atlasName, namingCulture } from "./atlasNaming";

export function culturalIdentity(
  state: GenerationState,
  kind: string,
  key: string,
  name: string,
  parent?: string
) {
  const id = semanticId(state.domain.world.id, kind, key);
  state.domain.world.entities[id] ??= {
    id,
    kind,
    name,
    state: "generated",
    attributes: parent
      ? { namingCulture: state.domain.world.entities[parent]?.attributes.namingCulture }
      : {},
    relations: parent ? [{ targetId: parent, kind: "derivedFrom" }] : [],
  };
  return id;
}
function originReach(state: GenerationState, origin: Entity) {
  const p = origin.attributes.center as Position;
  const nearest = nearestCommunity(state, p.x, p.y);
  return communityReach(state.society!.region, state.society!.region.communities.indexOf(nearest));
}
function nameFoundingCommunity(state: GenerationState, c: SocietyCommunity, culture: string) {
  const authored = c.causes.some((cause) => cause.startsWith("Authored starting community"));
  if (state.society!.inherited || c.protected || authored) return;
  c.name = atlasName(state.domain.world, {
    key: c.id,
    kind: "settlement",
    position: c.position,
    culture,
  }).name;
}
export function initializeCultures(state: GenerationState, context: MapProcessContext) {
  if (!state.society) initializePopulation(state, context);
  const work = state.society!;
  const origins = centers(state, context, "culture", Number(context.parameters.cultureCount ?? 3));
  const distances = origins.map((origin) => originReach(state, origin));
  for (const [i, c] of work.region.communities.entries()) {
    if (c.groups.every((g) => g.culture !== null)) continue;
    const scores = distances.map((d) => d[i]),
      closest = Math.min(...scores);
    let founders = origins.filter(
      (_origin, j) => Number.isFinite(scores[j]) && scores[j] === closest
    );
    if (!founders.length) {
      const id = culturalIdentity(state, "culture", c.id, `${c.name} culture`);
      founders = [state.domain.world.entities[id]];
      founders[0].attributes.center = c.position;
    }
    for (const origin of founders)
      origin.attributes.namingCulture ??= namingCulture(
        state.domain.world,
        origin.attributes.center as Position
      ).id;
    c.groups = mergePopulation(
      c.groups.flatMap((group) =>
        group.culture
          ? [group]
          : founders.map((origin) => ({
              ...group,
              culture: origin.id,
              count: group.count / founders.length,
              languages: [
                culturalIdentity(state, "language", origin.id, `${origin.name} language`),
              ],
              religions: [
                culturalIdentity(state, "religion", origin.id, `${origin.name} tradition`),
              ],
              practices: c.support.farming > c.support.grazing ? ["cultivation"] : ["pastoralism"],
            }))
      )
    );
    nameFoundingCommunity(state, c, founders[0].id);
  }
}
function dominantMembership(
  groups: PopulationGroup[],
  kind: "languages" | "religions" | "practices"
) {
  const totals = new Map<string, number>();
  for (const g of groups) for (const id of g[kind]) totals.set(id, (totals.get(id) ?? 0) + g.count);
  return [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}
function adopt(groups: PopulationGroup[], source: PopulationGroup[], fraction: number) {
  const language = dominantMembership(source, "languages"),
    faith = dominantMembership(source, "religions"),
    practice = dominantMembership(source, "practices");
  return mergePopulation(
    groups.flatMap((g) => [
      { ...g, count: g.count * (1 - fraction) },
      {
        ...g,
        count: g.count * fraction,
        languages: [...new Set([...g.languages, ...(language ? [language] : [])])],
        religions: [...new Set([...g.religions, ...(faith ? [faith] : [])])],
        practices: [...new Set([...g.practices, ...(practice ? [practice] : [])])],
      },
    ])
  );
}
function strongestContacts(state: GenerationState) {
  const { communities, connections } = state.society!.region;
  const byId = new Map(communities.map((c, i) => [c.id, i]));
  const contacts = communities.map(() => ({ index: -1, strength: 0 }));
  for (const link of connections) {
    const a = byId.get(link.from)!,
      b = byId.get(link.to)!;
    if (population(communities[a]) < 1 || population(communities[b]) < 1) continue;
    const strength = Math.exp(-link.travelCost / 150000);
    if (strength > contacts[a].strength) contacts[a] = { index: b, strength };
    if (strength > contacts[b].strength) contacts[b] = { index: a, strength };
  }
  return contacts;
}
function diverge(state: GenerationState, c: SocietyCommunity, years: number) {
  if (years < 300 || c.protected) return;
  for (const g of c.groups) {
    const parent = g.culture && state.domain.world.entities[g.culture];
    if (!parent || parent.relations?.some((r) => r.kind === "derivedFrom")) continue;
    g.culture = culturalIdentity(
      state,
      "culture",
      `${parent.id}:${c.id}`,
      `${c.name} tradition`,
      parent.id
    );
    state.domain.world.entities[g.culture].attributes.center = c.position;
    c.causes.push(
      `Isolation during ${years} years produced a local identity derived from ${parent.name}.`
    );
  }
}
export function diffuseCultures(state: GenerationState, context: MapProcessContext, years: number) {
  if (state.society!.inherited) return;
  const communities = state.society!.region.communities,
    contacts = strongestContacts(state);
  const mobility = Number(context.epochs.at(-1)?.variables.mobility ?? 1);
  for (const contact of contacts) contact.strength *= mobility;
  const before = communities.map((c) => c.groups);
  for (const [i, c] of communities.entries()) {
    if (c.protected || population(c) === 0) continue;
    const contact = contacts[i];
    if (contact.index < 0 || contact.strength < 0.1) {
      accumulateIsolation(state, c, years);
      continue;
    }
    c.isolationYears = 0;
    const fraction = 1 - Math.exp((-years * contact.strength) / 400);
    c.groups = adopt(before[i], before[contact.index], fraction);
  }
  context.recordCause({
    kind: "domain",
    process: "human.contact",
    subjects: [],
    description:
      "Languages, traditions and practices spread through contact without adding or moving people; isolated communities can retain and develop local identities.",
  });
}
function accumulateIsolation(state: GenerationState, c: SocietyCommunity, years: number) {
  c.isolationYears = (c.isolationYears ?? 0) + years;
  diverge(state, c, c.isolationYears);
}
export const cultureInitialize: MapProcess = {
  contract: {
    id: "human.identities",
    version: "1",
    parameters: {
      cultureCount: { type: "integer", unit: null, required: false, default: 3, minimum: 1 },
    },
    requires: ["population"],
    produces: ["cultures"],
    invalidates: [],
  },
  behavior: { kind: "initialize", initialize: initializeCultures },
  validate: () => [],
};
export const cultureContact: MapProcess = {
  contract: {
    id: "human.contact",
    version: "1",
    parameters: {},
    requires: ["cultures", "population"],
    produces: ["cultures"],
    invalidates: [],
  },
  behavior: { kind: "elapsed", duration: { kind: "epoch", fraction: 1 }, advance: diffuseCultures },
  validate: () => [],
};
