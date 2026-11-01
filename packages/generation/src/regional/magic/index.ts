import { type Band, type MagicSystem } from "@atlas/domain";
import { channel, clamp, neighbors, regionalComponents, type RegionalState } from "../state";
import { applyMagicEffects } from "./effects";
import { prepareFire, respondFire } from "./fire";
import { prepareGreenwood, prepareHallowed, respondGreenwood, respondHallowed } from "./land";
import { intensityChannel } from "./materials";
import { prepareSalt, respondSalt } from "./salt";
import { respondVeil } from "./veil";
import { prepareAurora, preparePressure, respondAurora, respondPressure } from "./water";

/** Per-system state the evaluation keeps between rounds. */
export interface MagicWork {
  systems: MagicSystem[];
  /** The captured intensity each evaluation starts from; effects are relative to it. */
  inherited: Map<string, Band>;
  prepared: boolean;
  /** Ocean cell count the kept Pressure ray field was traced over. */
  pressureOcean?: number;
}

const effectNames = [
  "quickening",
  "stillness",
  "verdure",
  "salting",
  "warding",
  "tearing",
  "fog",
] as const;

type SystemStep = (state: RegionalState, system: MagicSystem, intensity: Band) => void;
/** Salt last: its burn reads the captured Fire; Fire after Hallowed: cores unward their cell. */
const preparations: [string, (state: RegionalState, system: MagicSystem) => void][] = [
  ["hallowed", prepareHallowed],
  ["fire", prepareFire],
  ["aurora", prepareAurora],
  ["pressure", preparePressure],
  ["greenwood", prepareGreenwood],
  ["salt", prepareSalt],
];
const responses_: [string, SystemStep][] = [
  ["hallowed", respondHallowed],
  ["fire", respondFire],
  ["aurora", respondAurora],
  ["pressure", respondPressure],
  ["greenwood", respondGreenwood],
  ["salt", respondSalt],
];

/**
 * One evaluation of the enabled systems against the shared media as they are now. The first
 * evaluation prepares each system's materials once (deposits, drained charge, leached
 * strata, weathered beds); every evaluation then derives the fields from those materials,
 * the captured intensity and the present medium, wards and tears them, and writes their
 * effects through the contribution ledger. Returns the channels whose contribution changed.
 */
export function respondMagic(state: RegionalState): Map<string, number> {
  if (!state.input.domains.includes("magic")) return new Map();
  channel(state, "treeCover", "ratio", 0.2);
  const work = magicWork(state),
    by = (id: string) => work.systems.find((s) => s.id === id);
  if (!work.prepared) {
    for (const [id, prepare] of preparations) {
      const system = by(id);
      if (system) prepare(state, system);
    }
    work.prepared = true;
  }
  for (const system of work.systems) {
    const intensity = intensityChannel(state, system.id);
    intensity.copyFrom(work.inherited.get(system.id)!);
    if (system.id !== "hallowed") resolveMedium(state, system, intensity);
  }
  for (const [id, respond] of responses_) {
    const system = by(id);
    if (system) respond(state, system, intensityChannel(state, system.id));
  }
  wardAndTear(state, work, by);
  return applyMagicEffects(state, work.systems, work.inherited);
}

/** The kept per-system state, with each system's captured intensity copied once. */
function magicWork(state: RegionalState) {
  const g = state.surface,
    work = (state.magic ??= {
      systems: activeSystems(state),
      inherited: new Map(),
      prepared: false,
    });
  for (const system of work.systems)
    if (!work.inherited.has(system.id))
      work.inherited.set(system.id, g.coverage.copyBand(intensityChannel(state, system.id)));
  return work;
}

/** Hallowed wards the other fields; Veil tears where they strain against each other. */
function wardAndTear(
  state: RegionalState,
  work: MagicWork,
  by: (id: string) => MagicSystem | undefined
) {
  const fields = work.systems
    .filter((s) => !["hallowed", "veil"].includes(s.id))
    .map((s) => intensityChannel(state, s.id));
  if (by("hallowed"))
    for (const field of fields) wardField(state, field, intensityChannel(state, "hallowed"));
  const veil = by("veil");
  if (veil) respondVeil(state, veil, intensityChannel(state, "veil"), fields);
}

/** Enabled systems; a disabled system's captured fields and effects are zeroed, not developed. */
function activeSystems(state: RegionalState) {
  const configured = state.domain.world.magicSystems ?? [];
  for (const system of configured)
    if (!system.enabled || system.strength === 0) deactivate(state, system);
  return configured.filter((system) => system.enabled && system.strength > 0);
}
function deactivate(state: RegionalState, system: MagicSystem) {
  for (const [name, values] of Object.entries(state.surface.channels))
    if (name.startsWith(`magic:${system.id}:`) && /:(intensity|source)$/.test(name)) values.fill(0);
  for (const name of effectNames)
    if (system.effects[name] && state.surface.channels[name]) state.surface.channels[name].fill(0);
}

/** Each material responds to its own carrier and local environment. */
const responses: Record<string, (c: Record<string, Band>, i: number, t: number) => number> = {
  fire: (c, i, t) => (c.water.get(i) === 1 ? 0 : 0.7 + c.fracture.get(i) * 0.5 + t * 0.3),
  aurora: (c, i, t) =>
    clamp(0.8 + (c.ice?.get(i) ?? 0) * 0.4 - c.temperature.get(i) / 60 + t * 0.15, 0.1, 1.5),
  pressure: (c, i, t) =>
    c.water.get(i) === 1
      ? clamp(0.7 + Math.log1p(c.waterDepth.get(i) / 1000) * 0.15 + t * 0.25, 0.2, 1.4)
      : 0,
  greenwood: (c, i, t) =>
    c.water.get(i) !== 0 || (c.ice?.get(i) ?? 0) > 0.3 || c.soilDepth.get(i) < 0.1
      ? 0
      : clamp(
          (0.4 + c.treeCover.get(i) + c.moisture.get(i) * 0.4) *
            (1 - clamp(c.slope.get(i) * 3)) *
            (1 + t * 0.2) *
            clamp((c.treeCover.get(i) + (c.grassCover?.get(i) ?? 0)) * 4),
          0,
          1.5
        ),
  salt: (c, i, t) =>
    c.water.get(i) === 1
      ? 0.2
      : clamp(
          1.2 - c.moisture.get(i) * 0.5 + t * 0.15 + (c.sediment?.get(i) ?? 0) * 0.01,
          0.4,
          1.5
        ),
  hallowed: (c, i) => (c.water.get(i) === 0 ? 1 : 0),
  veil: (c, i, t) => (c.water.get(i) === 0 ? 0.8 + c.fracture.get(i) * 0.4 + t * 0.15 : 0),
};
/** The captured field through its present medium alone; the medium's own organization is the texture. */
function resolveMedium(state: RegionalState, system: MagicSystem, intensity: Band) {
  const g = state.surface;
  for (let i = 0; i < intensity.length; i++) {
    const medium = responses[system.id]?.(g.channels, i, 0) ?? 1;
    intensity.set(i, clamp(intensity.get(i) * medium, 0, 1000));
  }
}

/** A ward scales every other field down inside and lays what it removed on its rim. */
function wardField(state: RegionalState, field: Band, ward: Band) {
  const g = state.surface;
  regionalComponents(
    g,
    (i) => ward.get(i) > 0,
    (members) => {
      const rim = new Set<number>();
      let displaced = 0;
      for (const i of members) {
        const removed = field.get(i) * clamp(ward.get(i) / 1000) * 0.8;
        field.add(i, -removed);
        displaced += removed * g.measures.get(i);
        for (const j of neighbors(g, i)) if (ward.get(j) <= 0) rim.add(j);
      }
      let rimArea = 0;
      for (const i of rim) rimArea += g.measures.get(i);
      // A sanctuary extending beyond the frame can displace charge outside this map.
      if (!rimArea) return;
      for (const i of rim) field.set(i, clamp(field.get(i) + displaced / rimArea, 0, 1000));
    }
  );
}
