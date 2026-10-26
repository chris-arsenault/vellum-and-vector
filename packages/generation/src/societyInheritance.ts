import {
  mergePopulation,
  population,
  spatial,
  type SocietyRegion,
  type SocietyCommunity,
  type SocietyWork,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import { refreshSocietyConnections, refreshSocietySupport } from "./societyGeography";
import { territoryShape } from "./societyPoliticalPublication";
import { inheritSocietyDrainage } from "./societyDrainage";
import { realizeDemands } from "./societyDemand";
import { localTownAllocations } from "./regionalSociety";

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
  const heirs = new Map<string, Heir[]>();
  const local = localTownAllocations(prior.communities, prior.connections);
  for (const origin of prior.communities) {
    if (!origin.footprint || spatial.area(origin.footprint) <= 0) continue;
    heirs.set(origin.id, inheritOrigin(region, origin, local.get(origin.id) ?? 0));
  }
  region.history = structuredClone(prior.history);
  region.works = inheritWorks(state, prior, heirs);
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
  region.connections = structuredClone(prior.connections);
  refreshSocietyConnections(state);
  realizeDemands(state);
}
interface Heir {
  c: SocietyCommunity;
  share: number;
}
/**
 * Each community whose footprint overlaps the origin's inherits people by the share of the
 * origin's country it holds; the one holding the origin's seat carries its identity.
 */
function inheritOrigin(region: SocietyRegion, origin: SocietyCommunity, latent: number): Heir[] {
  const area = spatial.area(origin.footprint!),
    home = region.communities.find(
      (c) => c.footprint && spatial.pointCoverage(c.footprint)(origin.position)
    ),
    heirs: Heir[] = [];
  for (const c of region.communities) {
    if (!c.footprint || !spatial.intersects(origin.footprint!, c.footprint)) continue;
    const overlap = spatial.intersection(origin.footprint!, c.footprint);
    if (!overlap) continue;
    const share = spatial.area(overlap) / area;
    heirs.push({ c, share });
    const fraction = inheritedFraction(origin, c === home, share);
    c.groups = mergePopulation([
      ...c.groups,
      ...origin.groups.map((g) => ({ ...g, count: g.count * fraction })),
    ]);
    c.causes.push(
      `Inherited ${(fraction * 100).toFixed(2)}% of ${origin.name}; completed history retained.`
    );
    c.parentCommunity = origin.id;
    c.latentSettlementPopulation = (c.latentSettlementPopulation ?? 0) + latent * share;
    c.protected ||= origin.protected;
    if (c === home) carryIdentity(c, origin);
  }
  return heirs;
}
/**
 * A located work comes with the ground it stands on. A demand comes with the unit's
 * country: every heir of the unit inside this area carries it together, at the share of the
 * unit's country they hold between them, and realization searches all their land for the
 * site. Until then the heir with the largest share speaks for it.
 */
function inheritWorks(
  state: GenerationState,
  prior: SocietyRegion,
  heirs: Map<string, Heir[]>
): SocietyWork[] {
  const covered = spatial.pointCoverage(state.domain.scope.footprint),
    works: SocietyWork[] = [];
  for (const w of prior.works) {
    if (!w.demand) {
      if (covered(w.position)) works.push(structuredClone(w));
      continue;
    }
    const country = (heirs.get(w.communityId) ?? []).sort((a, b) => b.share - a.share);
    if (!country.length) continue;
    const share = Math.min(
      1,
      country.reduce((sum, heir) => sum + heir.share, 0)
    );
    const work = structuredClone(w);
    work.communityId = country[0].c.id;
    work.country = country.map((heir) => heir.c.id);
    work.position = country[0].c.position;
    work.magnitude *= share;
    work.causes.push(
      `Inherited at ${(share * 100).toFixed(1)}% of the demand, the share of the unit's country this area holds across ${country.length} heirs.`
    );
    works.push(work);
  }
  return works;
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
  c.site = structuredClone(origin.site);
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
