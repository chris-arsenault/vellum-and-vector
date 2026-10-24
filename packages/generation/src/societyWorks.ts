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
import { nearestCommunity } from "./societyPopulation";
import { societyValue } from "./societySupport";
import { authoredFields } from "./mapAuthored";
import { anchorRiverWork } from "./societyWaterUse";
import { nearestSocietySample, samplesInBox } from "./societySpatial";
import { societyWorkName } from "./societyNaming";

export function nearestSample(state: GenerationState, p: { x: number; y: number }) {
  return nearestSocietySample(state.surface, p);
}
export function makeWork(
  state: GenerationState,
  c: SocietyCommunity,
  kind: SocietyWorkKind,
  position = c.position
): SocietyWork {
  const work: SocietyWork = {
    id: semanticId(state.domain.world.id, "society-work", `${c.id}:${kind}`),
    communityId: c.id,
    kind,
    position,
    radius: Math.min(5000, Math.sqrt(c.areaKm2) * 200),
    magnitude: 1,
    condition: 1,
    maintained: true,
    authored: false,
    built: state.society!.region.history.at(-1)?.id ?? "Settlement",
    applied: 0,
    causes: [],
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
  if (needsWater(state, c, i)) kinds.push("irrigation");
  if (v("slope") > 0.08 && state.society!.region.connections.length) kinds.push("pass");
  if (c.support.water < 0.5 && state.society!.river[i] > 0.4) kinds.push("dam");
  return kinds;
}
/**
 * The cold-age set of a mobile round: hunt the crowded herds, burn the groves open, dig into
 * the veins, quarry the prisms, build weirs in the bays. Small bands do all of it.
 */
function coldAgeWorks(state: GenerationState, c: SocietyCommunity): SocietyWorkKind[] {
  if (population(c) < 40) return [];
  const i = nearestSample(state, c.position),
    v = (name: string) => societyValue(state, name, i);
  const kinds: SocietyWorkKind[] = [];
  if (v("herbivores") > 0.001) kinds.push("hunting");
  if (v("treeCover") > 0.25) kinds.push("burning");
  if (coldAgeSite(state, c, "magic:fire:intensity", 100, 25_000) >= 0) kinds.push("tapping");
  if (coldAgeSite(state, c, "magic:aurora:feature:prism", 1, 30_000) >= 0) kinds.push("quarrying");
  if (state.society!.coast[i] > 0 && population(c) >= 100) kinds.push("weir");
  return kinds;
}
/** The nearest sample within reach where a channel reaches a threshold, or -1. */
function coldAgeSite(
  state: GenerationState,
  c: SocietyCommunity,
  channel: string,
  threshold: number,
  reach: number,
  accepts: (i: number) => boolean = () => true
) {
  const { x, y } = c.position;
  let best = -1,
    distance = reach;
  for (const i of samplesInBox(state.surface, [x - reach, y - reach, x + reach, y + reach])) {
    if (societyValue(state, channel, i) < threshold || !accepts(i)) continue;
    const p = gridPosition(state.surface, i),
      d = Math.hypot(p.x - x, p.y - y);
    if (d < distance) [best, distance] = [i, d];
  }
  return best;
}
/** Where a cold-age work stands: the vein, the prism ridge, the shallow water of the bay. */
function placeColdAgeWork(state: GenerationState, c: SocietyCommunity, work: SocietyWork) {
  const grid = state.surface;
  const at =
    work.kind === "tapping"
      ? coldAgeSite(state, c, "magic:fire:intensity", 100, 25_000)
      : work.kind === "quarrying"
        ? coldAgeSite(state, c, "magic:aurora:feature:prism", 1, 30_000)
        : work.kind === "weir"
          ? coldAgeSite(
              state,
              c,
              "water",
              1,
              15_000,
              (i) => societyValue(state, "waterDepth", i) < 30
            )
          : -1;
  if (at >= 0) work.position = gridPosition(grid, at);
  // A band's works are small and near its camp.
  work.radius = Math.min(work.radius, 6000);
}
function needsWater(state: GenerationState, c: SocietyCommunity, i: number) {
  return c.support.water < 0.5 && state.society!.river[i] > 0.2;
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
      if (kind === "dam" || kind === "irrigation") anchorRiverWork(state, candidate);
      if (work.round) placeColdAgeWork(state, c, candidate);
      if (!existing.has(candidate.id)) {
        work.region.works.push(candidate);
        existing.add(candidate.id);
      }
    }
  if (!work.round) addHarbors(state, existing);
  addAuthoredWorks(state, existing);
}
function addHarbors(state: GenerationState, existing: Set<string>) {
  const grid = state.surface;
  const shores = Array.from(grid.active.keys()).filter(
    (i) => societyValue(state, "water", i) === 1 && societyValue(state, "waterDepth", i) < 30
  );
  for (const c of state.society!.region.communities) {
    if (population(c) < 1000) continue;
    const work = makeWork(state, c, "harbor");
    if (existing.has(work.id)) continue;
    const near = shores.find((i) => {
      const p = gridPosition(grid, i);
      return Math.hypot(p.x - c.position.x, p.y - c.position.y) < 10000;
    });
    if (near === undefined) continue;
    work.position = gridPosition(grid, near);
    state.society!.region.works.push(work);
    existing.add(work.id);
  }
}
function addAuthoredWorks(state: GenerationState, existing: Set<string>) {
  const work = state.society!;
  for (const f of Object.values(state.domain.world.features)) {
    if (!isSocietyWork(f) || f.state === "generated" || f.geometry.type !== "Point") continue;
    const id = String(f.attributes.workId ?? f.id);
    if (f.areaId !== state.domain.scope.areaId || existing.has(id)) continue;
    const [x, y] = f.geometry.coordinates,
      c = nearestCommunity(state, x, y);
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
export function applyPresentWorks(state: GenerationState) {
  const region = state.society!.region;
  addAuthoredWorks(state, new Set(region.works.map((w) => w.id)));
  for (const work of region.works) {
    if (work.previousShape) {
      applyWork(state, { ...work, ...work.previousShape, magnitude: 0, condition: 0 }, 0);
      delete work.previousShape;
    }
    if (!work.authored || work.applied === work.magnitude * work.condition) continue;
    applyWork(state, work, 0);
    work.causes.push(
      "Present authored work refreshed its environmental dependencies without advancing an era."
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
export function changeSample(state: GenerationState, channel: string, i: number, value: number) {
  const values = state.surface.channels[channel];
  if (!values || !Number.isFinite(value) || values[i] === value) return;
  if (state.physical && channel === "elevation") {
    state.society!.elevationBefore ??= values.slice();
  }
  values[i] = value;
  state.society!.changed.add(channel);
}
export function workSamples(state: GenerationState, work: SocietyWork) {
  const samples: { i: number; fraction: number }[] = [];
  const { x, y } = work.position,
    r = work.radius;
  for (const i of samplesInBox(state.surface, [x - r, y - r, x + r, y + r])) {
    const p = gridPosition(state.surface, i),
      d = Math.hypot(p.x - work.position.x, p.y - work.position.y);
    if (d <= work.radius) samples.push({ i, fraction: Math.exp(-d / Math.max(1, work.radius)) });
  }
  if (!samples.length) {
    const i = nearestSample(state, work.position);
    if (i >= 0)
      samples.push({
        i,
        fraction: Math.min(1, (Math.PI * work.radius ** 2) / state.surface.measures[i]),
      });
  }
  return samples;
}
export function applySocietyWorks(
  state: GenerationState,
  context: MapProcessContext,
  years: number
) {
  if (state.society!.inherited) return;
  planSocietyWorks(state);
  for (const work of state.society!.region.works) {
    const c = state.society!.region.communities.find((c) => c.id === work.communityId);
    const maintained = work.maintained && c && population(c) > 100;
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
/**
 * Consequences that live in the physical workspace rather than a published channel: a weir
 * marks its seabed as a shoal that reflects Pressure rays after the sea drowns it; quarrying
 * a prism ridge removes the charge that holds its ice still.
 */
function applyNativeColdAgeWork(
  state: GenerationState,
  work: SocietyWork,
  i: number,
  amount: number,
  years: number
) {
  const physical = state.physical;
  if (!physical) return;
  const cell = physical.samples[i];
  if (cell === undefined || cell < 0) return;
  if (work.kind === "weir") physical.map.FeatureFlags[cell] |= 1 << 11;
  if (work.kind === "quarrying") {
    const removed = Math.exp((-amount * years) / 100);
    for (const field of physical.magic?.fields ?? [])
      if (field.definition.effects.icePersistence > 0) field.stored[cell] *= removed;
    physical.map.IcePersistence[cell] *= removed;
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
