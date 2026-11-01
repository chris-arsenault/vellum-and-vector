import { gridPosition, type Band, type MagicSystem } from "@atlas/domain";
import { fractalNoise } from "../../canonry/noise";
import { channel, clamp, naturalChannel, neighbors, type RegionalState } from "../state";
import { meetingEffects } from "./meetings";
import { presentValue } from "./materials";
import { saltGroundEffects } from "./salt";

const effectChannels = [
  "quickening",
  "stillness",
  "verdure",
  "salting",
  "warding",
  "tearing",
  "fog",
] as const;

/**
 * What the evaluated fields do to the shared media. Effect channels are functions of the
 * present intensities. Physical changes (heat, rock, fractures, ice, soil, water supply,
 * coasts, relief) are declared as totals relative to the captured intensity and written
 * through the contribution ledger, so a round updates its influence rather than adding it.
 * Returns the channels whose applied total changed.
 */
export function applyMagicEffects(
  state: RegionalState,
  systems: MagicSystem[],
  inherited: Map<string, Band>
) {
  const g = state.surface,
    c = g.channels,
    ledger = state.contributions,
    add = (name: string, i: number, amount: number) => ledger.add(name, i, amount);
  for (const name of [
    "ice",
    "runoff",
    "soilDepth",
    "wetlandCover",
    "moisture",
    "rainfall",
    "fracture",
    "rock",
  ])
    naturalChannel(state, name, naturalUnit(name), name === "rock" ? 1 : 0);
  const naturalIce = state.natural.ice,
    naturalRunoff = state.natural.runoff,
    naturalMoisture = state.natural.moisture,
    naturalRain = state.natural.rainfall,
    outputs = Object.fromEntries(
      effectChannels.map((name) => [name, channel(state, name, "ratio")])
    );
  for (const name of effectChannels) outputs[name].fill(0);
  ledger.begin();
  for (const system of systems) {
    const intensity = c[`magic:${system.id}:intensity`],
      before = inherited.get(system.id)!,
      e = system.effects;
    for (const name of effectChannels) {
      const strength = e[name];
      if (!strength) continue;
      const output = outputs[name];
      for (let i = 0; i < intensity.length; i++)
        output.set(i, Math.max(output.get(i), clamp((intensity.get(i) / 1000) * strength)));
    }
    for (let i = 0; i < intensity.length; i++) {
      const delta = (intensity.get(i) - before.get(i)) / 1000;
      if (e.heat) add("temperature", i, ((intensity.get(i) - before.get(i)) * e.heat) / 10);
      if (!delta) continue;
      add("rock", i, (delta * e.rockResistance) / 4000);
      add("fracture", i, (delta * e.conduitOpening) / 1000);
      const heldIce = delta * e.icePersistence * clamp(1 - Math.max(0, c.temperature.get(i)) / 15),
        melted = delta * e.iceMelt * Math.min(1, naturalIce.get(i));
      add("ice", i, heldIce - melted);
      if (c.water.get(i) !== 0) continue;
      if (e.verdure) {
        add("soilDepth", i, delta * e.verdure * 0.3);
        add("runoff", i, -naturalRunoff.get(i) * delta * e.verdure * 0.25);
        add("wetlandCover", i, Math.max(0, delta) * e.verdure * clamp(1 - c.slope.get(i) / 0.01));
      }
      if (e.salting) {
        const drying = clamp(1 - delta * e.salting * system.parameters.desiccation, 0.1, 2) - 1;
        add("moisture", i, naturalMoisture.get(i) * drying);
        add("rainfall", i, naturalRain.get(i) * drying);
        add("runoff", i, naturalRunoff.get(i) * drying);
      }
    }
    if (system.id === "pressure") pressureCoast(state, system, intensity, before, outputs.fog);
    if (system.id === "veil") veilRelief(state, system);
    if (system.id === "salt") saltGroundEffects(state, system, add);
  }
  meetingEffects(state, (name, i, amount) =>
    name === "fog" ? outputs.fog.set(i, Math.max(outputs.fog.get(i), amount)) : add(name, i, amount)
  );
  const changed = ledger.commit(c, { rock: 0.01, soilDepth: 0.02, ice: 0, fracture: 0 });
  if (c.iceThickness && changed.has("ice"))
    for (let i = 0; i < c.ice.length; i++) c.iceThickness.set(i, c.ice.get(i) * 1000);
  return changed;
}

function naturalUnit(name: string) {
  return (
    {
      ice: "ratio",
      runoff: "metre/year",
      soilDepth: "metre",
      wetlandCover: "ratio",
      moisture: "ratio",
      rainfall: "metre/year",
    }[name] ?? "ratio"
  );
}

/** A front shoaling on the coast lifts cold water, settles fog and wears the facing shore. */
function pressureCoast(
  state: RegionalState,
  system: MagicSystem,
  intensity: Band,
  before: Band,
  fog: Band
) {
  const g = state.surface,
    c = g.channels,
    upwelling = channel(state, "upwelling", "ratio"),
    e = system.effects;
  upwelling.fill(0);
  for (let i = 0; i < intensity.length; i++) {
    if (c.water.get(i) !== 1) continue;
    const shoaling = clamp(1 - c.waterDepth.get(i) / 1000),
      forcing = (intensity.get(i) / 1000) * shoaling;
    upwelling.set(i, clamp(forcing * e.upwelling));
    state.contributions.add(
      "temperature",
      i,
      (((intensity.get(i) - before.get(i)) * e.seaSurface) / 10) * shoaling
    );
    for (const j of neighbors(g, i)) {
      if (c.water.get(j) !== 0) continue;
      fog.set(j, Math.max(fog.get(j), forcing * e.fog));
      const ward = clamp((c["magic:hallowed:intensity"]?.get(j) ?? 0) / 1000);
      state.contributions.add("elevation", j, -forcing * e.coastalForcing * (1 - ward));
    }
  }
}

/** Wild zones roughen their ground; a door sinks its pool. */
function veilRelief(state: RegionalState, system: MagicSystem) {
  const g = state.surface;
  for (let i = 0; i < g.active.length; i++) {
    if (g.channels.water.get(i) !== 0) continue;
    const p = gridPosition(g, i),
      wild = presentValue(state, "magic:veil:wild", i),
      relief =
        fractalNoise(p.x, p.y, state.input.seed ^ 0x7e11, (g.scope.resolution ?? 1000) * 4, 2) *
        wild *
        system.parameters.wildRelief,
      door = presentValue(state, "magic:veil:origin:door:source", i) > 0;
    if (relief) state.contributions.add("elevation", i, relief);
    if (door) state.contributions.add("elevation", i, -system.parameters.doorPool);
  }
}
