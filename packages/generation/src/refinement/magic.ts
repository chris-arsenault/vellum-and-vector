import { fieldPosition, gridPosition, KeyedHeap, type MagicSystem, type Band } from "@atlas/domain";
import { fractalNoise } from "../canonry/noise";
import {
  channel,
  clamp,
  distance,
  neighbors,
  regionalComponents,
  type RefinementState,
} from "./state";
import { applyRegionalMeetings } from "./meetings";
import { generationFeatures } from "../generationFeatures";
import { developRegionalFire } from "./magicFire";
import { developRegionalAurora, developRegionalPressure } from "./magicWater";
import { developRegionalGreenwood, developRegionalHallowed } from "./magicLand";
import { developRegionalSalt } from "./magicSalt";
import { developRegionalVeil } from "./magicVeil";
import { developMagicGeography } from "./magicEffects";
import { presentValue } from "./magicMaterials";

/** Present materials develop locally, without another historical era. */
export function refineMagic(state: RefinementState) {
  if (!state.input.domains.includes("magic")) return;
  const systems = activeRegionalSystems(state),
    g = state.surface,
    previous = new Map(
      systems.map((system) => [
        system.id,
        g.coverage.copyBand(channel(state, `magic:${system.id}:intensity`, "relative-intensity")),
      ])
    ),
    thermal = new Map<string, Band>();
  prepareMagicSources(state, systems);
  for (const system of systems) {
    developSystem(state, system);
    if (system.effects.heat) {
      const intensity = g.channels[`magic:${system.id}:intensity`];
      applyTemperature(state, system, previous.get(system.id)!, intensity);
      thermal.set(system.id, g.coverage.copyBand(intensity));
    }
  }
  wardAndTear(state, systems);
  const veil = systems.find((s) => s.id === "veil");
  if (veil) developRegionalVeil(state, veil, g.channels["magic:veil:intensity"]);
  for (const system of systems) {
    applyPresentEffects(
      state,
      system,
      thermal.get(system.id) ?? previous.get(system.id)!,
      g.channels[`magic:${system.id}:intensity`]
    );
    const applied = thermal.get(system.id);
    if (applied) g.coverage.release(applied);
  }
  developMagicGeography(state, systems, previous);
  applyRegionalMeetings(state);
  for (const before of previous.values()) g.coverage.release(before);
}

function activeRegionalSystems(state: RefinementState) {
  channel(state, "treeCover", "ratio", 0.2);
  const configured = state.domain.world.magicSystems ?? [];
  for (const system of configured)
    if (!system.enabled || system.strength === 0) deactivateSystem(state, system);
  return configured.filter((system) => system.enabled && system.strength > 0);
}
function deactivateSystem(state: RefinementState, system: MagicSystem) {
  for (const [name, values] of Object.entries(state.surface.channels))
    if (name.startsWith(`magic:${system.id}:`) && /:(intensity|source)$/.test(name)) values.fill(0);
  for (const name of [
    "quickening",
    "stillness",
    "verdure",
    "salting",
    "warding",
    "tearing",
    "fog",
  ] as const)
    if (system.effects[name] && state.surface.channels[name]) state.surface.channels[name].fill(0);
}
function prepareMagicSources(state: RefinementState, systems: MagicSystem[]) {
  const hallowed = systems.find((s) => s.id === "hallowed");
  if (hallowed) {
    const intensity = state.surface.channels["magic:hallowed:intensity"];
    resolveMedium(state, hallowed, intensity);
    developRegionalHallowed(state, hallowed, intensity);
  }
  const fire = systems.find((s) => s.id === "fire");
  if (fire) {
    developRegionalFire(state, fire);
    seedCapturedCores(state);
  }
}
function developSystem(state: RefinementState, system: MagicSystem) {
  const intensity = state.surface.channels[`magic:${system.id}:intensity`];
  if (system.id !== "hallowed") resolveMedium(state, system, intensity);
  switch (system.id) {
    case "fire":
      spreadFire(state, system, intensity);
      break;
    case "aurora":
      developRegionalAurora(state, system, intensity);
      break;
    case "pressure":
      developRegionalPressure(state, system, intensity);
      break;
    case "greenwood":
      developRegionalGreenwood(state, system, intensity);
      break;
    case "salt":
      developRegionalSalt(state, system, intensity);
      break;
  }
}
function applyTemperature(
  state: RefinementState,
  system: MagicSystem,
  previous: Band,
  intensity: Band
) {
  for (let i = 0; i < intensity.length; i++)
    state.surface.channels.temperature.add(
      i,
      ((intensity.get(i) - previous.get(i)) * system.effects.heat) / 10
    );
}
function seedCapturedCores(state: RefinementState) {
  const g = state.surface,
    source = channel(state, "magic:fire:source", "relative-intensity");
  for (const f of generationFeatures(state, { areaId: state.input.areaId })) {
    if (f.kind !== "fire:core" || f.geometry.type !== "Point") continue;
    const p = fieldPosition(g, {
        x: f.geometry.coordinates[0],
        y: f.geometry.coordinates[1],
        z: 0,
      }),
      { x, y } = p,
      col = Math.round(((x - g.bounds[0]) / (g.bounds[2] - g.bounds[0])) * (g.width - 1)),
      row = Math.round(((y - g.bounds[1]) / (g.bounds[3] - g.bounds[1])) * (g.height - 1)),
      i = row * g.width + col;
    if (col < 0 || row < 0 || col >= g.width || row >= g.height) continue;
    source.set(i, Math.max(source.get(i), Number(f.attributes.intensity ?? 500)));
  }
}
function resolveMedium(state: RefinementState, system: MagicSystem, intensity: Band) {
  const g = state.surface;
  for (let i = 0; i < intensity.length; i++) {
    const p = gridPosition(g, i),
      texture = fractalNoise(
        p.x,
        p.y,
        state.input.seed ^ system.id.length,
        Math.max((g.scope.resolution ?? 1000) * 4, state.parentSpan / 2),
        3
      ),
      medium = mediumResponse(state, system.id, i, texture);
    intensity.set(i, clamp(intensity.get(i) * medium, 0, 1000));
  }
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
function mediumResponse(state: RefinementState, id: string, i: number, texture: number) {
  return responses[id]?.(state.surface.channels, i, texture) ?? 1;
}
/** Vein releases travel along fractures; fallen and forge stocks release where they lie. */
function spreadFire(state: RefinementState, system: MagicSystem, intensity: Band) {
  const g = state.surface,
    source = g.channels[`magic:${system.id}:source`];
  if (!source) return;
  const front = new KeyedHeap("max"),
    carried = g.coverage.scratch("float64", "regional:fire-conduit", intensity.length),
    p = system.parameters;
  seedFireFront(state, system, source, intensity, carried, front);
  while (front.size) {
    const i = front.pop();
    if (front.poppedKey() !== carried.get(i)) continue;
    for (const j of neighbors(g, i)) {
      if (
        g.channels.water.get(j) === 1 ||
        presentValue(state, "magic:hallowed:intensity", j) >= 500
      )
        continue;
      const fracture = (g.channels.fracture.get(i) + g.channels.fracture.get(j)) / 2,
        cost =
          ((p.baseCost + ((1 - clamp(fracture)) * 1000) / p.conductanceDivisor) *
            distance(g, i, j)) /
          1000,
        next = carried.get(i) - cost;
      if (next <= carried.get(j)) continue;
      carried.set(j, next);
      front.push(j, next);
    }
  }
  for (let i = 0; i < intensity.length; i++)
    intensity.set(i, Math.max(intensity.get(i), carried.get(i)));
  g.coverage.release(carried);
}
interface FireOrigin {
  source: Band | undefined;
  conductive: boolean;
}
function seedFireFront(
  state: RefinementState,
  system: MagicSystem,
  source: Band,
  intensity: Band,
  carried: Band,
  front: KeyedHeap
) {
  const g = state.surface,
    origins = system.origins.map((origin) => ({
      source: g.channels[`magic:fire:origin:${origin.id}:source`],
      conductive: origin.propagation === "fracture",
    }));
  for (let i = 0; i < source.length; i++) {
    const release = conduitRelease(origins, source, i);
    intensity.set(i, Math.max(intensity.get(i), source.get(i)));
    if (release > 0) {
      carried.set(i, release);
      front.push(i, release);
    }
    if (source.get(i) > 0 && g.channels["magic:hallowed:intensity"])
      g.channels["magic:hallowed:intensity"].set(i, 0);
  }
}
function conduitRelease(origins: FireOrigin[], source: Band, i: number) {
  let attributed = 0,
    release = 0;
  for (const origin of origins) {
    const own = origin.source?.get(i) ?? 0;
    attributed = Math.max(attributed, own);
    if (origin.conductive) release = Math.max(release, own);
  }
  return attributed === 0 ? Math.max(release, source.get(i)) : release;
}
function applyPresentEffects(
  state: RefinementState,
  system: MagicSystem,
  previous: Band,
  intensity: Band
) {
  const g = state.surface,
    e = system.effects;
  const effects: [string, number][] = [
    ["quickening", e.quickening],
    ["stillness", e.stillness],
    ["verdure", e.verdure],
    ["salting", e.salting],
    ["warding", e.warding],
    ["tearing", e.tearing],
    ["fog", e.fog],
  ];
  for (const [name, strength] of effects) {
    if (!strength) continue;
    const output = channel(state, name, "ratio");
    for (let i = 0; i < intensity.length; i++)
      output.set(i, clamp((intensity.get(i) / 1000) * strength));
  }
  if (e.heat)
    for (let i = 0; i < intensity.length; i++)
      g.channels.temperature.add(i, ((intensity.get(i) - previous.get(i)) * e.heat) / 10);
}
function wardAndTear(state: RefinementState, systems: MagicSystem[]) {
  const g = state.surface,
    ward = g.channels["magic:hallowed:intensity"],
    veil = g.channels["magic:veil:intensity"],
    fields = systems
      .filter((s) => !["hallowed", "veil"].includes(s.id))
      .map((s) => g.channels[`magic:${s.id}:intensity`]);
  if (ward) for (const field of fields) wardField(state, field, ward);
  const veilSystem = systems.find((s) => s.id === "veil");
  if (!veil || !veilSystem || fields.length < 2) return;
  for (let i = 0; i < g.active.length; i++) {
    const strain = localStrain(state, fields, i),
      held = clamp(presentValue(state, "magic:hallowed:intensity", i) / 1000);
    const p = veilSystem.parameters,
      knitted = (strain / 1000) * (1 - p.knitVerdure * presentValue(state, "verdure", i)),
      strength = 1000 * clamp((knitted - p.tearFloor) / (p.tearFull - p.tearFloor));
    veil.set(i, clamp(Math.max(veil.get(i), strength) * (1 - held), 0, 1000));
  }
}
function localStrain(state: RefinementState, fields: Band[], i: number) {
  let strain = 0;
  for (let a = 0; a < fields.length; a++)
    for (let b = a + 1; b < fields.length; b++) {
      const meeting = Math.min(fields[a].get(i), fields[b].get(i)) / 1000;
      for (const j of neighbors(state.surface, i))
        strain = Math.max(
          strain,
          meeting *
            Math.abs(fields[a].get(i) - fields[b].get(i) - (fields[a].get(j) - fields[b].get(j)))
        );
    }
  return strain;
}
function wardField(state: RefinementState, field: Band, ward: Band) {
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
