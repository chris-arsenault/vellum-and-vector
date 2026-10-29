import {
  gridPosition,
  population,
  semanticId,
  spatial,
  societyWorkAttributesSchema,
  isSocietyWork,
  type SocietyCommunity,
  type SocietyWork,
  type SocietyWorkKind,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { generationFeatures } from "./generationFeatures";
import { applyNativeColdAgeWork } from "./societyNativeWorks";
import { withCommunityIndex } from "./societyPopulation";
import { societyValue, soilWaterCapacity } from "./societySupport";
import { drawShareAt } from "./societyMagicAccess";
import { isWorldSociety } from "./societyMapScope";
import { demandAmount, demandSamples, hasMedium } from "./societyDemand";
import { coldAgeWorks, placeColdAgeWork } from "./societyColdAge";
import { authoredFields } from "./mapAuthored";
import { anchorRiverWork } from "./societyWaterUse";
import { nearestSample, samplesInBox } from "./societySpatial";
import { societyWorkName } from "./societyNaming";

export function makeWork(
  state: GenerationState,
  c: SocietyCommunity,
  kind: SocietyWorkKind,
  position?: SocietyCommunity["position"]
): SocietyWork {
  // A World unit makes demands of its country; only a finer profile, or an explicit
  // position, locates a work.
  const demand = position === undefined && isWorldSociety(state),
    radius = Math.min(5000, Math.sqrt(c.areaKm2) * 200);
  const work: SocietyWork = {
    id: semanticId(state.domain.world.id, "society-work", `${c.id}:${kind}`),
    communityId: c.id,
    kind,
    position: position ?? c.position,
    radius,
    magnitude: 1,
    condition: 1,
    maintained: true,
    authored: false,
    built: state.society!.region.history.at(-1)?.id ?? "Settlement",
    applied: 0,
    causes: [],
    ...(demand ? { demand: demandAmount(state, c, kind, radius) } : {}),
  };
  const named = societyWorkName(state.domain.world, c, work);
  work.name = named.name;
  work.naming = {
    language: named.namingLanguage,
    culture: named.namingCulture,
    era: work.built,
  };
  return work;
}
function proposedWorks(state: GenerationState, c: SocietyCommunity): SocietyWorkKind[] {
  return state.society!.round ? coldAgeWorks(state, c) : settledWorks(state, c);
}
function settledWorks(state: GenerationState, c: SocietyCommunity): SocietyWorkKind[] {
  if (population(c) < 500) return [];
  const i = nearestSample(state, c.position),
    v = (name: string) => societyValue(state, name, i);
  const kinds: SocietyWorkKind[] = [];
  if (v("treeCover") > 0.25 && c.support.farming > c.support.gathering) kinds.push("clearance");
  const wildlife = wildlifeWork(state, c, i);
  if (wildlife) kinds.push(wildlife);
  if (needsWater(state, c, i, 0.2)) kinds.push("irrigation");
  if (v("slope") > 0.08 && state.society!.region.connections.length) kinds.push("pass");
  if (needsWater(state, c, i, 0.4)) kinds.push("dam");
  return kinds;
}
/** A dry community beside a river carrying more than `flow`; -1 is no surface sample. */
function needsWater(state: GenerationState, c: SocietyCommunity, i: number, flow: number) {
  return c.support.water < 0.5 && i >= 0 && state.society!.river.get(i) > flow;
}
function wildlifeWork(
  state: GenerationState,
  c: SocietyCommunity,
  i: number
): SocietyWorkKind | null {
  if (societyValue(state, "herbivores", i) <= 0.001) return null;
  return c.groups.some((g) => g.practices.includes("conservation")) ? "conservation" : "hunting";
}
export function planSocietyWorks(state: GenerationState) {
  const work = state.society!,
    existing = new Set(work.region.works.map((w) => w.id));
  for (const c of work.region.communities)
    for (const kind of proposedWorks(state, c)) {
      const candidate = makeWork(state, c, kind);
      if (!candidate.demand && (kind === "dam" || kind === "irrigation"))
        anchorRiverWork(state, candidate);
      if (work.round && !candidate.demand) placeColdAgeWork(state, c, candidate);
      if (!existing.has(candidate.id)) {
        work.region.works.push(candidate);
        existing.add(candidate.id);
      }
    }
  if (!work.round) addHarbors(state, existing);
  addAuthoredWorks(state, existing);
}
/**
 * A unit demands a harbour of the shore it holds: its coast medium, the same cells the demand
 * is later realized on. A located harbour (a finer profile) snaps to shallow water near the
 * seat.
 */
function addHarbors(state: GenerationState, existing: Set<string>) {
  const grid = state.surface;
  for (const c of state.society!.region.communities) {
    if (population(c) < 1000) continue;
    const work = makeWork(state, c, "harbor");
    if (existing.has(work.id)) continue;
    if (work.demand) {
      if (!hasMedium(state, work)) continue;
    } else {
      const near = harborSample(state, c.position);
      if (near === undefined) continue;
      work.position = gridPosition(grid, near);
    }
    state.society!.region.works.push(work);
    existing.add(work.id);
  }
}
function harborSample(state: GenerationState, position: SocietyCommunity["position"]) {
  const { x, y } = position;
  for (const i of samplesInBox(state.surface, [x - 10000, y - 10000, x + 10000, y + 10000])) {
    if (societyValue(state, "water", i) !== 1 || societyValue(state, "waterDepth", i) >= 30)
      continue;
    const p = gridPosition(state.surface, i);
    if (Math.hypot(p.x - x, p.y - y) < 10000) return i;
  }
  return undefined;
}
function addAuthoredWorks(state: GenerationState, existing: Set<string>) {
  withCommunityIndex(state, (nearest) => addAuthoredWorksNear(state, existing, nearest));
}
function addAuthoredWorksNear(
  state: GenerationState,
  existing: Set<string>,
  nearest: (x: number, y: number) => SocietyCommunity
) {
  const work = state.society!;
  for (const f of generationFeatures(state)) {
    if (!isSocietyWork(f) || f.state === "generated") continue;
    const id = String(f.attributes.workId ?? f.id);
    if (f.areaId !== state.domain.scope.areaId || existing.has(id)) continue;
    const { x, y } = spatial.interiorPosition(f.geometry),
      c = nearest(x, y);
    if (!c) continue;
    const candidate = makeWork(state, c, f.attributes.workKind as SocietyWorkKind, { x, y, z: 0 });
    candidate.id = id;
    candidate.name = f.name;
    delete candidate.naming;
    candidate.authored = true;
    configureWork(candidate, f.attributes);
    candidate.maintained = f.attributes.maintained !== false;
    work.region.works.push(candidate);
    existing.add(candidate.id);
  }
}
function configureWork(candidate: SocietyWork, attributes: Record<string, unknown>) {
  const parsed = societyWorkAttributesSchema.parse({
    radius: candidate.radius,
    magnitude: 1,
    ...attributes,
  });
  candidate.radius = parsed.radius;
  candidate.magnitude = parsed.magnitude;
  candidate.kind = parsed.workKind;
}
/**
 * Present works at an inherited profile: authored works, and the works this area realized
 * from inherited demands, act on the surface here without advancing an era.
 */
export function applyPresentWorks(state: GenerationState) {
  const region = state.society!.region,
    area = state.domain.scope.areaId;
  addAuthoredWorks(state, new Set(region.works.map((w) => w.id)));
  for (const work of region.works) {
    if (work.previousShape) {
      applyWork(state, { ...work, ...work.previousShape, magnitude: 0, condition: 0 }, 0);
      delete work.previousShape;
    }
    const present = work.authored || work.realizedAt === area;
    if (!present || work.applied === work.magnitude * work.condition) continue;
    applyWork(state, work, 0);
    work.causes.push(
      work.authored
        ? "Present authored work refreshed its environmental dependencies without advancing an era."
        : "Realized work applied to this profile's surface without advancing an era."
    );
  }
}
export function editableSamples(state: GenerationState, channel: string) {
  const authorities = authoredFields(state.domain)
    .filter((a) => a.channels?.includes(channel))
    .filter((a) => !a.spaceId || a.spaceId === state.domain.scope.spaceId)
    .map((a) => spatial.pointCoverage(a.footprint ?? a.source!.scope.footprint));
  return (i: number) => !authorities.some((covers) => covers(gridPosition(state.surface, i)));
}
/**
 * Edit one surface sample and record the channel. A work acts on a mesh-scale medium, so its
 * edit may re-route water or re-propagate magic; a practice acts at its seat cell, which is
 * below that scale, so its edit is synchronized but moves nothing else (ADR 0005).
 */
export function changeSample(
  state: GenerationState,
  channel: string,
  i: number,
  value: number,
  cause: "work" | "practice" = "work"
) {
  const values = state.surface.channels[channel];
  if (!values || !Number.isFinite(value) || values.get(i) === value) return;
  if (state.physical && channel === "elevation") {
    state.society!.elevationBefore ??= state.surface.coverage.copyBand(values);
    state.society!.elevationBefore.retain();
  }
  values.set(i, value);
  state.society!.changed.add(channel);
  if (cause === "work") state.society!.mediumChanged.add(channel);
}
export function* workSamples(state: GenerationState, work: SocietyWork) {
  if (work.demand) {
    yield* demandSamples(state, work);
    return;
  }
  let found = false;
  const { x, y } = work.position,
    r = work.radius;
  for (const i of samplesInBox(state.surface, [x - r, y - r, x + r, y + r])) {
    const p = gridPosition(state.surface, i),
      d = Math.hypot(p.x - work.position.x, p.y - work.position.y);
    if (d <= work.radius) {
      found = true;
      yield { i, fraction: Math.exp(-d / Math.max(1, work.radius)) };
    }
  }
  if (!found) {
    const i = nearestSample(state, work.position);
    if (i >= 0)
      yield {
        i,
        fraction: Math.min(1, (Math.PI * work.radius ** 2) / state.surface.measures.get(i)),
      };
  }
}
export function applySocietyWorks(
  state: GenerationState,
  context: MapProcessContext,
  years: number
) {
  if (state.society!.inherited) return;
  planSocietyWorks(state);
  // A band of 40 keeps up its cold-age works; a settled work needs a hundred hands.
  const hands = state.society!.round ? 40 : 100;
  for (const work of state.society!.region.works) {
    const c = state.society!.region.communities.find((c) => c.id === work.communityId);
    const maintained = work.maintained && c && population(c) >= hands;
    work.condition *= maintained ? 1 : Math.exp(-years / 80);
    applyWork(state, work, years);
  }
  context.recordCause({
    kind: "domain",
    process: "human.works",
    subjects: state.society!.region.works.map((w) => w.id),
    description:
      "Located works alter terrain, water use, plant cover and hunting pressure; maintenance follows surviving communities.",
  });
}
function applyWork(state: GenerationState, work: SocietyWork, years: number) {
  const target = work.magnitude * work.condition,
    delta = target - work.applied;
  const permitted = new Map<string, (i: number) => boolean>();
  const change = (name: string, i: number, value: number) => {
    if (!permitted.has(name)) permitted.set(name, editableSamples(state, name));
    if (permitted.get(name)!(i)) changeSample(state, name, i, value);
  };
  for (const { i, fraction } of workSamples(state, work)) {
    const edit = (name: string, value: number) => change(name, i, value);
    applyWorkSample(
      state,
      work,
      i,
      { amount: target * fraction, rise: delta * fraction, years },
      edit
    );
  }
  work.applied = target;
}
interface WorkDose {
  /** Work applied at this sample, for effects that scale with elapsed years. */
  amount: number;
  /** Change in applied work at this sample, for one-off terrain and conductance changes. */
  rise: number;
  years: number;
}
/** Settled works shape terrain, water, cover and herds; the cold-age set digs, burns, quarries and builds weirs. */
function applyWorkSample(
  state: GenerationState,
  work: SocietyWork,
  i: number,
  { amount, rise, years }: WorkDose,
  edit: (name: string, value: number) => void
) {
  const v = (name: string) => societyValue(state, name, i);
  const terrain: Partial<Record<SocietyWorkKind, number>> = {
    pass: -8,
    harbor: 5,
    dam: 6,
    weir: 4,
  };
  if (terrain[work.kind]) edit("elevation", v("elevation") + terrain[work.kind]! * rise);
  // Tapping cracks the sinter and opens the fracture: conductance rises, Fire reaches further.
  if (work.kind === "tapping") edit("fracture", Math.min(1, v("fracture") + 0.25 * rise));
  if (work.kind === "weir" || work.kind === "quarrying")
    applyNativeColdAgeWork(state, work, i, amount, years);
  applyLivingWork(state, work, i, amount, years, edit);
}
/** Works on water, cover and herds, which act over the years they are kept up. */
function applyLivingWork(
  state: GenerationState,
  work: SocietyWork,
  i: number,
  amount: number,
  years: number,
  edit: (name: string, value: number) => void
) {
  const v = (name: string) => societyValue(state, name, i);
  switch (work.kind) {
    case "irrigation":
      return irrigate(state, i, amount, edit);
    case "clearance":
      return clearLand(state, i, amount, years, edit);
    case "burning":
      return clearLand(state, i, amount * 1.5, years, edit);
    case "hunting":
      for (const animal of ["herbivores", "grazers", "browsers"])
        edit(animal, v(animal) * Math.exp((-amount * years) / 150));
      return;
    case "conservation":
      return conserve(state, i, amount, years, edit);
    default:
      return;
  }
}
function irrigate(
  state: GenerationState,
  i: number,
  amount: number,
  edit: (name: string, value: number) => void
) {
  const available = societyValue(state, "flow", i),
    diverted = Math.min(available * 0.2, amount);
  edit("flow", available - diverted);
  edit("soilWater", societyValue(state, "soilWater", i) + diverted * 0.02);
}
/**
 * Clearing and burning take the trees and what lives in them: the Greenwood's sap under the
 * cleared ground goes with the cover, and with no canopy to draw it the soil's water rises
 * toward what the soil can hold, the water table a Salt brine climbs.
 */
function clearLand(
  state: GenerationState,
  i: number,
  amount: number,
  years: number,
  edit: (name: string, value: number) => void
) {
  const fraction = 1 - Math.exp(-amount * (years > 0 ? years / 200 : 1));
  for (const channel of [
    "treeCover",
    "broadleafCover",
    "coniferCover",
    "broadleafSaplings",
    "coniferSaplings",
  ])
    edit(channel, societyValue(state, channel, i) * (1 - fraction));
  edit("grassCover", Math.min(1, societyValue(state, "grassCover", i) + fraction * 0.3));
  const capacity = soilWaterCapacity(state, i);
  edit(
    "soilWater",
    Math.min(capacity, societyValue(state, "soilWater", i) + fraction * 0.3 * capacity)
  );
  drawShareAt(state, "greens", "sap", i, fraction);
}
function conserve(
  state: GenerationState,
  i: number,
  amount: number,
  years: number,
  edit: (name: string, value: number) => void
) {
  const current = societyValue(state, "herbivores", i);
  const capacity = societyValue(state, "productivity", i) * 0.05;
  edit(
    "herbivores",
    current + Math.max(0, capacity - current) * (1 - Math.exp((-amount * years) / 50))
  );
}
