import {
  gridPosition,
  population,
  type SocietyCommunity,
  type SocietyMagicPractice,
} from "@atlas/domain";
import type { GenerationState, MapProcessContext } from "./process";
import {
  changeSample,
  editableSamples,
  makeWork,
  nearestSample,
  workSamples,
} from "./societyWorks";
import { societyValue } from "./societySupport";
import { peopleTrait } from "./societyTraits";
import { samplesInBox } from "./societySpatial";

export function magicAt(
  state: GenerationState,
  propagation: string,
  i: number,
  channel = "intensity"
) {
  const system = state.domain.world.magicSystems?.find(
    (s) => s.enabled && s.propagation === propagation
  );
  return system ? societyValue(state, `magic:${system.id}:${channel}`, i) / 1000 : 0;
}
function initialPractice(state: GenerationState, c: SocietyCommunity): SocietyMagicPractice {
  const i = nearestSample(state, c.position),
    ice = societyValue(state, "iceThickness", i);
  // A one-time mineral estimate. Extraction consumes this deposit; field intensity is not fuel.
  const deposit = Math.max(0, magicAt(state, "fracture", i)) * Math.min(c.areaKm2, 100) * 100;
  return {
    communityId: c.id,
    coreDeposit: deposit,
    coreSupply: 0,
    coreUsed: 0,
    heatApplied: 0,
    crystals: magicAt(state, "cold-drainage", i) * Math.min(1000, ice),
    charge: 0,
    readers: 0,
    memoryAccess: 0,
    pressureCharge: 0,
    pressureUsed: 0,
    maritimeContact: 0,
    divers: 0,
    depthLimit: peopleTrait(state, c, "divingDepth", 200),
    injuries: 0,
    strain: 0,
  };
}
function workFor(
  state: GenerationState,
  c: SocietyCommunity,
  kind: "fire-forge" | "aurora-archive" | "pressure-diving"
) {
  const region = state.society!.region;
  const existing = region.works.find((w) => w.communityId === c.id && w.kind === kind);
  if (existing) return existing;
  const work = makeWork(state, c, kind);
  region.works.push(work);
  return work;
}
function fireUse(
  state: GenerationState,
  c: SocietyCommunity,
  practice: SocietyMagicPractice,
  years: number
) {
  const extracted = Math.min(practice.coreDeposit, population(c) * years * 0.002);
  practice.coreDeposit -= extracted;
  practice.coreSupply += extracted;
  const demand = population(c) * years * 0.0005,
    used = Math.min(practice.coreSupply, demand);
  practice.coreSupply -= used;
  practice.coreUsed += used;
  if (used <= 0 && practice.heatApplied <= 0) return;
  const work = workFor(state, c, "fire-forge"),
    heat = (8 * used) / Math.max(1, demand);
  const editableHeat = editableSamples(state, "temperature"),
    editableIce = editableSamples(state, "iceThickness");
  for (const { i, fraction } of workSamples(state, work)) {
    if (editableHeat(i))
      changeSample(
        state,
        "temperature",
        i,
        societyValue(state, "temperature", i, 15) + (heat - practice.heatApplied) * fraction
      );
    if (editableIce(i))
      changeSample(
        state,
        "iceThickness",
        i,
        Math.max(0, societyValue(state, "iceThickness", i) - heat * fraction * years * 0.02)
      );
  }
  practice.injuries += used * 0.002;
  practice.heatApplied = heat;
  work.causes = [
    `Consumed ${used.toFixed(1)} core-equivalents for contact heat; ${practice.coreDeposit.toFixed(1)} remain in the deposit.`,
  ];
}
function auroraUse(
  state: GenerationState,
  c: SocietyCommunity,
  p: SocietyMagicPractice,
  years: number
) {
  if (p.crystals <= 0) return;
  const i = nearestSample(state, c.position),
    intensity = magicAt(state, "cold-drainage", i);
  const cold = Math.max(0, Math.min(1, -societyValue(state, "temperature", i) / 10));
  const retained = Math.min(1, societyValue(state, "iceThickness", i) / 10) * cold;
  p.crystals *= Math.exp((-years * (1 - retained)) / 200);
  p.charge = Math.min(p.crystals, p.charge + (intensity * p.crystals * years) / 50);
  p.readers = (population(c) * 0.005) / (1 + p.strain);
  const use = Math.min(p.charge, p.readers * years * 0.02);
  p.charge -= use;
  p.strain = p.strain * Math.exp(-years / 20) + use / Math.max(1, p.readers * 100);
  p.memoryAccess = Math.min(
    1,
    p.memoryAccess * Math.exp((-years * (1 - retained)) / 200) + use / Math.max(1, population(c))
  );
  const work = workFor(state, c, "aurora-archive");
  work.causes = [
    `Cold memory-bearing ice and ${p.crystals.toFixed(1)} crystals support ${p.readers.toFixed(1)} readers; access is limited by charge and cognitive strain.`,
  ];
}
function pressureUse(
  state: GenerationState,
  c: SocietyCommunity,
  p: SocietyMagicPractice,
  years: number
) {
  const i = accessibleDive(state, c, p.depthLimit);
  const nearby = state.society!.region.works.find(
    (w) => w.communityId === c.id && w.kind === "pressure-diving"
  );
  const at = nearby ? nearestSample(state, nearby.position) : i;
  if (at < 0) {
    p.divers = 0;
    p.pressureCharge *= Math.exp(-years / 5);
    return;
  }
  const depth = societyValue(state, "waterDepth", at);
  const ocean = societyValue(state, "water", at) === 1;
  const enabled = ocean && depth >= 50 && depth <= p.depthLimit;
  const intensity = enabled ? magicAt(state, "ocean-rays", at) : 0;
  p.divers = intensity > 0 ? (population(c) * 0.002) / (1 + p.strain) : 0;
  p.pressureCharge = Math.max(
    0,
    p.pressureCharge * Math.exp(-years / 5) + intensity * p.divers * (1 - Math.exp(-years / 5))
  );
  // Carried Pressure dissipates near Aurora crystals rather than combining into a spell.
  p.pressureCharge *= Math.exp(-p.crystals / 10);
  if (p.divers <= 0) return;
  p.strain += p.pressureCharge / Math.max(1, p.divers * 10);
  const spent = p.pressureCharge * (1 - Math.exp(-years / 10));
  p.pressureCharge -= spent;
  p.pressureUsed += spent;
  p.maritimeContact = spent / Math.max(1, p.divers);
  // Directed force assists located harbor maintenance; it cannot strengthen an entire coast.
  const harbor = state.society!.region.works.find(
    (w) => w.kind === "harbor" && w.communityId === c.id
  );
  if (harbor) harbor.condition = Math.min(1, harbor.condition + spent / Math.max(1, population(c)));
  const work = workFor(state, c, "pressure-diving");
  work.position = gridPosition(state.surface, at);
  work.causes = [
    `${p.divers.toFixed(1)} practitioners reach ${depth.toFixed(0)} m within a ${p.depthLimit} m tolerance; directed force and subsonic contact consumed ${spent.toFixed(1)} carried charge.`,
  ];
}
function accessibleDive(state: GenerationState, c: SocietyCommunity, limit: number) {
  let best = -1,
    distance = Math.min(100000, Math.sqrt(c.areaKm2) * 1500);
  const { x, y } = c.position;
  for (const i of samplesInBox(state.surface, [
    x - distance,
    y - distance,
    x + distance,
    y + distance,
  ])) {
    const depth = societyValue(state, "waterDepth", i);
    if (societyValue(state, "water", i) !== 1 || depth < 50 || depth > limit) continue;
    const p = gridPosition(state.surface, i),
      d = Math.hypot(p.x - c.position.x, p.y - c.position.y);
    if (d < distance) {
      best = i;
      distance = d;
    }
  }
  return best;
}
function distributeCores(state: GenerationState, years: number) {
  const region = state.society!.region,
    practices = new Map(region.magic.map((p) => [p.communityId, p]));
  for (const link of region.connections) {
    const a = practices.get(link.from),
      b = practices.get(link.to);
    if (!a || !b) continue;
    const surplus =
      (a.coreSupply - b.coreSupply) *
      (1 - Math.exp(-years / 35)) *
      Math.exp(-link.travelCost / 200000);
    a.coreSupply -= surplus;
    b.coreSupply += surplus;
  }
}
export function useSocietyMagic(state: GenerationState, context: MapProcessContext, years: number) {
  const region = state.society!.region;
  if (state.society!.inherited) return;
  const previous = new Map(region.magic.map((p) => [p.communityId, p]));
  region.magic = region.communities.map((c) => previous.get(c.id) ?? initialPractice(state, c));
  for (const [i, c] of region.communities.entries()) {
    if (c.protected) continue;
    const p = region.magic[i];
    p.injuries *= Math.exp(-years / 30);
    fireUse(state, c, p, years);
    auroraUse(state, c, p, years);
    pressureUse(state, c, p, years);
  }
  distributeCores(state, years);
  context.recordCause({
    kind: "domain",
    process: "human.magic-use",
    subjects: [],
    description:
      "Fire use consumes mined cores; Aurora access depends on cold crystals and rested readers; Pressure practice requires reachable ocean depth. Their costs and media remain distinct.",
  });
}
