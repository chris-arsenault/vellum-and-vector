import {
  mergePopulation,
  population,
  spatial,
  type SocietyRegion,
  type SocietyCommunity,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import { refreshSocietyConnections, refreshSocietySupport } from "./societyGeography";
import { territoryShape } from "./societyPoliticalPublication";
import { inheritSocietyDrainage } from "./societyDrainage";

export function societyAncestor(state: GenerationState) {
  const world = state.domain.world;
  for (
    let area: string | null = state.domain.scope.areaId;
    area;
    area = world.areas[area].parentId
  ) {
    const society = world.societies?.[area];
    if (society) return society;
  }
  return undefined;
}
export function retainSocietyFootprints(state: GenerationState) {
  for (const c of state.society!.region.communities)
    c.footprint = territoryShape(state, new Set([c.id])) ?? c.footprint;
}
export function inheritSociety(state: GenerationState, prior: SocietyRegion) {
  const work = state.society!;
  if (prior.areaId === work.region.areaId) {
    work.region = structuredClone(prior);
    refreshSocietyConnections(state);
  } else refineSociety(state, prior);
  work.inherited = true;
  refreshSocietySupport(state);
  inheritSocietyDrainage(state);
}
function refineSociety(state: GenerationState, prior: SocietyRegion) {
  const work = state.society!,
    region = work.region;
  retainSocietyFootprints(state);
  for (const origin of prior.communities) {
    if (!origin.footprint) continue;
    const area = spatial.area(origin.footprint);
    if (area <= 0) continue;
    const home = region.communities.find(
      (c) => c.footprint && spatial.pointCoverage(c.footprint)(origin.position)
    );
    for (const c of region.communities) {
      if (!c.footprint || !spatial.intersects(origin.footprint, c.footprint)) continue;
      const overlap = spatial.intersection(origin.footprint, c.footprint);
      if (!overlap) continue;
      const fraction = inheritedFraction(origin, c === home, spatial.area(overlap) / area);
      c.groups = mergePopulation([
        ...c.groups,
        ...origin.groups.map((g) => ({ ...g, count: g.count * fraction })),
      ]);
      c.causes.push(
        `Inherited ${(fraction * 100).toFixed(2)}% of ${origin.name}; completed history retained.`
      );
      c.parentCommunity = origin.id;
      c.protected ||= origin.protected;
      if (c === home) carryIdentity(c, origin);
    }
  }
  region.history = structuredClone(prior.history);
  region.works = structuredClone(
    prior.works.filter((w) => spatial.pointCoverage(state.domain.scope.footprint)(w.position))
  );
  region.events = structuredClone(
    prior.events.filter((e) =>
      spatial.intersects(
        spatial.buffer({ type: "Point", coordinates: [e.position.x, e.position.y] }, e.radius)!,
        state.domain.scope.footprint
      )
    )
  );
  region.magic = structuredClone(
    prior.magic.filter((p) => region.communities.some((c) => c.id === p.communityId))
  );
  inheritPolitics(region, prior);
  refreshSocietyConnections(state);
}
function inheritedFraction(origin: SocietyCommunity, located: boolean, areaFraction: number) {
  const total = population(origin),
    urban = origin.settlement?.population ?? 0;
  return ((total - urban) * areaFraction + (located ? urban : 0)) / Math.max(1, total);
}
function carryIdentity(c: SocietyCommunity, origin: SocietyCommunity) {
  c.id = origin.id;
  c.name = origin.name;
  c.position = origin.position;
  c.status = origin.status;
  c.founded = origin.founded;
  c.settlement = structuredClone(origin.settlement);
  c.history = structuredClone(origin.history);
  c.naming = structuredClone(origin.naming);
}
function inheritPolitics(region: SocietyRegion, prior: SocietyRegion) {
  if (!prior.politics) return;
  region.politics = structuredClone(prior.politics);
  const p = region.politics;
  p.sovereignty = {};
  p.control = {};
  p.contested = {};
  for (const c of region.communities) {
    const parent = c.parentCommunity!;
    if (prior.politics.sovereignty[parent])
      p.sovereignty[c.id] = prior.politics.sovereignty[parent];
    if (prior.politics.control[parent]) p.control[c.id] = prior.politics.control[parent];
    if (prior.politics.contested[parent]) p.contested[c.id] = prior.politics.contested[parent];
  }
  for (const polity of p.polities)
    polity.claims = region.communities
      .filter((c) => polity.claims.includes(c.parentCommunity!))
      .map((c) => c.id);
}
