import {
  communityPractices,
  population,
  semanticId,
  type PracticeShares,
  type SocietyPolity,
  type Entity,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext, MapProcess } from "./process";
import { practiceOpportunities, seekingFactor } from "./societySeeking";
import { centers } from "./mapPeople";
import { profileOf } from "./societyProfile";
import { initializePopulation, nearestCommunity } from "./societyPopulation";
import { communityReach } from "./societyContact";
import { generationBindings } from "./generationBindings";
import { namePolity } from "./societyNaming";
import { relocatePolitySeats } from "./societyHierarchy";
import { besiegeLost } from "./societySiege";

export function initializePolitics(state: GenerationState, context: MapProcessContext) {
  if (!state.society) initializePopulation(state, context);
  const region = state.society!.region;
  if (region.politics) return;
  const count =
    context.parameters.polityCount ??
    (context.inputs?.features ? generationBindings(context).parameters.polityCount : 3);
  const established = new Set(Object.keys(state.domain.world.entities));
  const entities = centers(state, context, "polity", Number(count));
  const polities: SocietyPolity[] = entities.flatMap((entity) => {
    const p = entity.attributes.center as { x: number; y: number };
    const seat = nearestCommunity(state, p.x, p.y);
    if (!established.has(entity.id)) namePolityAtSeat(state, entity, seat);
    return seat
      ? [
          {
            id: entity.id,
            seat: seat.id,
            support: 1,
            status: "active" as const,
            claims: [],
            causes: [],
          },
        ]
      : [];
  });
  region.politics = { polities, sovereignty: {}, control: {}, contested: {}, history: [] };
  // Founding claims can span disconnected land; effective control requires actual reach.
  for (const c of region.communities) {
    const rank = entities
      .map((e, i) => {
        const p = e.attributes.center as { x: number; y: number };
        return { i, d: Math.hypot(p.x - c.position.x, p.y - c.position.y) };
      })
      .sort((a, b) => a.d - b.d);
    const polity = polities[rank[0]?.i];
    if (!polity) continue;
    polity.claims.push(c.id);
    region.politics.sovereignty[c.id] = polity.id;
    region.politics.control[c.id] = polity.id;
  }
}
function namePolityAtSeat(
  state: GenerationState,
  entity: Entity,
  seat: ReturnType<typeof nearestCommunity>
) {
  if (seat) namePolity(state.domain.world, entity, seat, "Founding");
}
function institutionalSupport(state: GenerationState, polity: SocietyPolity) {
  const world = state.domain.world;
  return Object.values(world.features)
    .filter(
      (f) =>
        f.kind === "institution" &&
        (f.attributes.communityId === polity.seat ||
          f.relations.some((r) => r.targetId === polity.id))
    )
    .reduce((sum, f) => sum + Number(f.attributes.influence ?? 0.1), 0);
}
/** Reach falls with travel cost and rises where the seat's people know how to hold the country. */
function polityReach(
  state: GenerationState,
  polity: SocietyPolity,
  capacity: number,
  offers: PracticeShares[]
) {
  const region = state.society!.region;
  const seat = region.communities.findIndex((c) => c.id === polity.seat);
  const distance = communityReach(region, seat);
  const entity = state.domain.world.entities[polity.id];
  const scale = Math.max(1000, Number(entity?.attributes.reach ?? 250000));
  const health = Math.max(0, Math.min(1, polity.support));
  const institution = institutionalSupport(state, polity);
  const seeker = seat >= 0 ? communityPractices(region.communities[seat].groups) : {};
  return Float64Array.from(distance, (d, i) => {
    const c = region.communities[i],
      pressure = population(c) / Math.max(1, c.support.capacity);
    const damage = c.status === "ruined" ? 0.25 : 1;
    return (
      (Math.exp(-d / scale) *
        capacity *
        health *
        damage *
        (1 + institution) *
        seekingFactor(seeker, offers[i])) /
      Math.max(1, pressure)
    );
  });
}
function updateSupport(state: GenerationState, polity: SocietyPolity, years: number) {
  const region = state.society!.region;
  const residents = region.communities.filter(
    (c) => region.politics!.sovereignty[c.id] === polity.id
  );
  const total = residents.reduce((sum, c) => sum + population(c), 0);
  const supported = residents.reduce(
    (sum, c) =>
      sum + Math.min(population(c), c.support.capacity) * (c.status === "ruined" ? 0.1 : 1),
    0
  );
  const target = total > 0 ? supported / total : 0;
  polity.support += (target - polity.support) * (1 - Math.exp(-years / 80));
}
function controlCommunities(state: GenerationState, scores: Float64Array[], years: number) {
  const region = state.society!.region,
    politics = region.politics!;
  politics.control = {};
  politics.contested = {};
  politics.tenure ??= {};
  for (const [i, c] of region.communities.entries()) {
    const rank = politics.polities
      .map((p, j) => ({ p, score: scores[j][i] }))
      .sort((a, b) => b.score - a.score);
    const first = rank[0];
    if (!first || first.score < 0.12 || population(c) < 1) {
      delete politics.tenure[c.id];
      continue;
    }
    politics.control[c.id] = first.p.id;
    if (rank[1]?.score > first.score * 0.8)
      politics.contested[c.id] = rank.slice(0, 2).map((r) => r.p.id);
    retainControl(state, c.id, first, years);
  }
}
function retainControl(
  state: GenerationState,
  id: string,
  first: { p: SocietyPolity; score: number },
  years: number
) {
  const politics = state.society!.region.politics!;
  const previous = politics.tenure![id];
  const tenure = previous?.polity === first.p.id ? previous.years + years : years;
  politics.tenure![id] = { polity: first.p.id, years: tenure };
  if (tenure >= 100 && first.score > 0.45 && !politics.contested[id])
    consolidate(state, first.p, id);
}
function consolidate(state: GenerationState, polity: SocietyPolity, id: string) {
  state.society!.region.politics!.sovereignty[id] = polity.id;
  if (!polity.claims.includes(id)) polity.claims.push(id);
}
function successor(state: GenerationState, parent: SocietyPolity, community: string, era: string) {
  const region = state.society!.region,
    politics = region.politics!;
  const c = region.communities.find((c) => c.id === community)!;
  const id = semanticId(state.domain.world.id, "polity-successor", `${parent.id}:${c.id}`);
  if (politics.polities.some((p) => p.id === id)) return;
  const entity: Entity = {
    id,
    kind: "polity",
    name: `${c.name} commonwealth`,
    state: "generated",
    attributes: {
      center: c.position,
    },
    relations: [{ targetId: parent.id, kind: "derivedFrom" }],
  };
  state.domain.world.entities[id] = entity;
  namePolity(state.domain.world, entity, c, era);
  politics.polities.push({
    id,
    seat: c.id,
    support: 0.65,
    status: "active",
    claims: [c.id],
    causes: [`${era}: local authority formed after ${parent.id} lost effective reach.`],
  });
  politics.sovereignty[c.id] = id;
  politics.control[c.id] = id;
}
function recordPoliticalChanges(state: GenerationState, years: number, era: string) {
  const region = state.society!.region,
    politics = region.politics!;
  politics.isolation ??= {};
  for (const p of [...politics.polities]) {
    const controlled = Object.keys(politics.control).filter((id) => politics.control[id] === p.id);
    const status = !controlled.length
      ? "collapsed"
      : controlled.length < p.claims.length / 2
        ? "fragmented"
        : "active";
    const cause = `${era}: support ${p.support.toFixed(2)}, ${controlled.length} communities under effective control; older claims retained.`;
    const previous = p.status;
    p.status = status;
    p.causes.push(cause);
    besiegeLost(state, p, previous, era);
    politics.history.push({ era, polity: p.id, status, communities: controlled, cause });
    politics.isolation[p.id] = status === "active" ? 0 : (politics.isolation[p.id] ?? 0) + years;
    if (politics.isolation[p.id] < 100) continue;
    const independent = region.communities.filter(
      (c) => politics.sovereignty[c.id] === p.id && !politics.control[c.id] && c.status !== "ruined"
    );
    const seat = independent.sort((a, b) => population(b) - population(a))[0];
    if (seat && population(seat) > 100) successor(state, p, seat.id, era);
  }
}
export function evolvePolitics(state: GenerationState, context: MapProcessContext, years: number) {
  initializePolitics(state, context);
  if (state.society!.inherited) return;
  const region = state.society!.region,
    politics = region.politics!;
  const capacity =
    Number(context.epochs.at(-1)?.variables.politicalCapacity ?? 1) *
    profileOf(state).politicalReach;
  const era = context.epochs.at(-1)?.id ?? "Settlement";
  for (const p of politics.polities) updateSupport(state, p, years);
  applyPoliticalAnchors(state, era);
  relocatePolitySeats(state, era);
  const offers = practiceOpportunities(state);
  controlCommunities(
    state,
    politics.polities.map((p) => polityReach(state, p, capacity, offers)),
    years
  );
  recordPoliticalChanges(state, years, era);
  if (!state.society!.cycle) recoverCommunities(state, years, era);
  context.recordCause({
    kind: "domain",
    process: "human.political-change",
    subjects: politics.polities.map((p) => p.id),
    description: `${era}: political reach follows traversable connections, support, institutions and damage; claims survive lost control.`,
  });
}
function applyPoliticalAnchors(state: GenerationState, era: string) {
  if (state.society!.cycle && state.society!.cycle.index > 0) return;
  const politics = state.society!.region.politics!;
  for (const f of Object.values(state.domain.world.features)) {
    if (
      f.kind !== "societyEvent" ||
      f.state === "generated" ||
      f.attributes.era !== era ||
      f.attributes.eventKind !== "collapse"
    )
      continue;
    const polity = politics.polities.find((p) => p.id === f.attributes.polityId);
    if (polity) {
      polity.support = 0;
      polity.causes.push(`${era}: creator-authored collapse anchor ${f.name}.`);
    }
  }
}
function recoverCommunities(state: GenerationState, years: number, era: string) {
  const region = state.society!.region,
    politics = region.politics!;
  for (const c of region.communities) {
    if (
      c.protected ||
      c.status !== "ruined" ||
      population(c) < 100 ||
      c.support.capacity < population(c)
    )
      continue;
    if (years > 80 && politics.control[c.id]) {
      c.status = "inhabited";
      c.causes.push(`${era}: resettlement supported by renewed access and political control.`);
    }
  }
}
export const politicsInitialize: MapProcess = {
  contract: {
    id: "human.polity-origins",
    version: "1",
    parameters: {},
    requires: ["population"],
    produces: ["polities"],
    invalidates: [],
  },
  behavior: { kind: "initialize", initialize: initializePolitics },
  validate: () => [],
};
export const politicsChange: MapProcess = {
  contract: {
    id: "human.political-change",
    version: "1",
    parameters: {},
    requires: ["polities"],
    produces: ["politics"],
    invalidates: [],
  },
  behavior: { kind: "elapsed", duration: { kind: "epoch", fraction: 1 }, advance: evolvePolitics },
  validate: () => [],
};
