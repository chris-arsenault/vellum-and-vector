import type { GenerationState, MapProcessContext } from "../process";
import { clamp, rockResistance, round } from "./math";
import { Feature } from "./codes";
import { generationBindings } from "../generationBindings";
import type { MagicSystem } from "@atlas/domain";

export const coastalMagicParameters: (keyof MagicSystem["parameters"])[] = [
  "coastalThreshold",
  "waveAmplification",
  "currentAmplification",
];

export function magicThermalFeedback(state: GenerationState) {
  const work = state.physical!,
    magic = work.magic!,
    map = work.map;
  for (let i = 0; i < map.mesh.count; i++) {
    map.FeatureFlags[i] &= ~(Feature.FireCore | Feature.MagmaChamber);
    let heat = 0,
      melt = 0;
    for (const field of magic.fields) {
      if (!field.definition.enabled) continue;
      const effects = field.definition.effects;
      heat += field.intensity[i] * effects.heat;
      melt += field.intensity[i] * effects.iceMelt;
      if (effects.heat > 0 && field.source[i] > 0 && field.intensity[i] > 0) {
        map.FeatureFlags[i] |= Feature.FireCore;
        if (field.intensity[i] >= 940) map.FeatureFlags[i] |= Feature.MagmaChamber;
      }
    }
    // Replace this contribution; later climate passes use the same external forcing.
    const previous = magic.heat[i];
    magic.heat[i] = round(heat);
    map.ExternalHeatForcing[i] += magic.heat[i] - previous;
    map.Temperature[i] = clamp(map.Temperature[i] - previous + magic.heat[i], 0, 1000);
    map.IceThickness[i] = Math.max(0, map.IceThickness[i] - round(melt));
  }
}
export function magicRockFeedback(state: GenerationState) {
  const work = state.physical!,
    map = work.map;
  for (let i = 0; i < map.mesh.count; i++) {
    let delta = 0;
    for (const field of work.magic!.fields.filter((field) => field.definition.enabled))
      delta += (field.intensity[i] / 1000) * field.definition.effects.rockResistance;
    map.RockResistance[i] = rockResistance(map.RockResistance[i] + round(delta));
  }
}
function coastalEpoch(context?: MapProcessContext) {
  const count = context?.inputs?.features ? generationBindings(context).settings.epochs.length : 1;
  return context?.epochIndices[0] ?? Math.max(0, count - 1);
}
export function magicCoastalFeedback(state: GenerationState, context?: MapProcessContext) {
  const work = state.physical!,
    magic = work.magic!,
    map = work.map;
  const epoch = coastalEpoch(context);
  const fields = magic.fields.filter((field) => field.definition.enabled);
  for (let i = 0; i < map.mesh.count; i++) {
    let total = 0;
    for (const field of fields) {
      const multiplier = field.definition.effects.coastalForcing;
      if (!multiplier || map.WaterKindCodes[i] !== 0) continue;
      let pressure = 0,
        wave = 0,
        current = 0;
      for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
        const j = map.mesh.neighbors[i * map.mesh.stride + edge];
        if (j < 0 || map.WaterKindCodes[j] !== 1) continue;
        pressure = Math.max(pressure, field.intensity[j]);
        wave = Math.max(wave, map.WaveExposure[j]);
        current = Math.max(current, map.OceanCurrentStrength[j]);
      }
      const p = field.definition.parameters;
      if (pressure < p.coastalThreshold) continue;
      const forcing = clamp(
        round(
          (((pressure - p.coastalThreshold) * 1000) / (1000 - p.coastalThreshold) +
            wave * p.waveAmplification +
            current * p.currentAmplification) *
            multiplier
        ),
        1,
        1000
      );
      total += forcing;
      field.coastalHistory[i] += forcing;
      if (field.coastalFirstEpoch[i] < 0) field.coastalFirstEpoch[i] = epoch;
    }
    map.ExternalCoastalForcing[i] += clamp(total, 0, 1000) - magic.coastal[i];
    magic.coastal[i] = clamp(total, 0, 1000);
  }
}
export function retainMagicHistory(state: GenerationState, context: MapProcessContext) {
  const map = state.physical!.map,
    index = coastalEpoch(context);
  for (const field of state.physical!.magic!.fields) {
    if (!field.definition.enabled) continue;
    const retention = field.definition.history;
    let active = 0,
      maximum = 0;
    for (let i = 0; i < map.mesh.count; i++) {
      const value = field.intensity[i];
      field.history[i] += value;
      field.stored[i] = field.stored[i] * retention.retention + value * retention.storage;
      if (value > 0 && field.firstEpoch[i] < 0) field.firstEpoch[i] = index;
      if (i >= map.mesh.contentCount) continue;
      active += value > 0 ? map.mesh.areas[i] : 0;
      maximum = Math.max(maximum, value);
    }
    context.recordCause({
      kind: "domain",
      process: "canonry.magic-history",
      subjects: [],
      description: `${field.definition.name}: epoch ${index + 1}, ${Math.round(active / 1_000_000)} affected km², peak intensity ${maximum}; accumulated activity and first occurrence travel with the crust.`,
    });
  }
}
