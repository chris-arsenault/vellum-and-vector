import {
  gridPosition,
  population,
  semanticId,
  spatial,
  societyWorkAttributesSchema,
  type SocietyCommunity,
  type SocietyWork,
  type SocietyWorkKind,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import { nearestCommunity } from "./societyPopulation";
import { societyValue } from "./societySupport";
import { authoredFields } from "./mapAuthored";
import { anchorRiverWork } from "./societyWaterUse";

export function nearestSample(state: GenerationState, p: { x: number; y: number }) {
  let best = -1,
    distance = Infinity;
  for (let i = 0; i < state.surface.active.length; i++) {
    if (!state.surface.active[i]) continue;
    const q = gridPosition(state.surface, i),
      d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  return best;
}
export function makeWork(
  state: GenerationState,
  c: SocietyCommunity,
  kind: SocietyWorkKind,
  position = c.position
): SocietyWork {
  return {
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
}
function proposedWorks(state: GenerationState, c: SocietyCommunity): SocietyWorkKind[] {
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
      if (!existing.has(candidate.id)) {
        work.region.works.push(candidate);
        existing.add(candidate.id);
      }
    }
  addHarbors(state, existing);
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
    if (f.kind !== "societyWork" || f.state === "generated" || f.geometry.type !== "Point")
      continue;
    const id = String(f.attributes.workId ?? f.id);
    if (f.areaId !== state.domain.scope.areaId || existing.has(id)) continue;
    const [x, y] = f.geometry.coordinates,
      c = nearestCommunity(state, x, y);
    if (!c) continue;
    const candidate = makeWork(state, c, f.attributes.workKind as SocietyWorkKind, { x, y, z: 0 });
    candidate.id = id;
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
  values[i] = value;
  state.society!.changed.add(channel);
}
export function workSamples(state: GenerationState, work: SocietyWork) {
  const samples: { i: number; fraction: number }[] = [];
  for (let i = 0; i < state.surface.active.length; i++) {
    if (!state.surface.active[i]) continue;
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
    const v = (name: string) => societyValue(state, name, i),
      amount = target * fraction;
    const edit = (name: string, value: number) => change(name, i, value);
    if (work.kind === "pass") edit("elevation", v("elevation") - 8 * delta * fraction);
    if (work.kind === "harbor") edit("elevation", v("elevation") + 5 * delta * fraction);
    if (work.kind === "dam") edit("elevation", v("elevation") + 6 * delta * fraction);
    if (work.kind === "irrigation") irrigate(state, i, amount, edit);
    if (work.kind === "clearance") clearLand(state, i, amount, years, edit);
    if (work.kind === "hunting")
      for (const animal of ["herbivores", "grazers", "browsers"])
        edit(animal, v(animal) * Math.exp((-amount * years) / 150));
    if (work.kind === "conservation") conserve(state, i, amount, years, edit);
  }
  work.applied = target;
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
