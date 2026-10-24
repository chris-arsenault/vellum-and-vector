import type { GenerationState, MapProcessContext } from "../process";
import type { PhysicalField } from "./field";
import { clamp, rockResistance, round } from "./math";
import { Feature } from "./codes";
import { generationBindings } from "../generationBindings";
import type { MagicSystem } from "@atlas/domain";

export const coastalMagicParameters: (keyof MagicSystem["parameters"])[] = [
  "coastalThreshold",
  "waveAmplification",
  "currentAmplification",
];
const unit = (value: number) => Math.max(0, Math.min(1, value));
type Field = NonNullable<NonNullable<GenerationState["physical"]>["magic"]>["fields"][number];

/**
 * A system that holds ice (Aurora) acts through the charge its ice holds, not through the
 * whole cold drainage its intensity maps: cooling and stillness belong to a strong live
 * field (intensity past 600) or to strong relict charge (stored past 300), and only where
 * at least a skin of ice remains. Other systems act at their full intensity.
 */
export function heldCharge(map: PhysicalField, field: Field, i: number) {
  if (!field.definition.effects.icePersistence) return 1;
  const strength = Math.max((field.stored[i] - 300) / 150, (field.intensity[i] - 600) / 300);
  return unit(strength) * unit(map.IceThickness[i] / 50);
}
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
      heat +=
        field.intensity[i] * effects.heat * (effects.heat < 0 ? heldCharge(map, field, i) : 1);
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
    // Melt is a removal, not a level: within one epoch each cell loses at most the largest
    // melt any evaluation asked for, so the climate and post-glacial passes do not both melt.
    const owed = Math.max(0, round(melt) - magic.melt[i]);
    magic.melt[i] = Math.max(magic.melt[i], round(melt));
    map.IceThickness[i] = Math.max(0, map.IceThickness[i] - owed);
  }
}
/**
 * Living forcings the ecology consumes as its own terms: Fire quickens, Aurora stills.
 * Both stay with the field; neither travels in air or water.
 */
export function magicLivingFeedback(state: GenerationState) {
  const work = state.physical!,
    map = work.map,
    fields = work.magic!.fields.filter((field) => field.definition.enabled);
  for (let i = 0; i < map.mesh.count; i++) {
    let quickening = 0,
      stillness = 0;
    for (const field of fields) {
      const share = field.intensity[i] / 1000;
      quickening += share * field.definition.effects.quickening;
      stillness += share * field.definition.effects.stillness * heldCharge(map, field, i);
    }
    map.Quickening[i] = unit(quickening);
    map.Stillness[i] = unit(stillness);
  }
}
/** Shelf, water shallower than 400 m, or a cell on the shore: where a ray lifts deep water. */
function shoals(map: PhysicalField, i: number) {
  if ([2, 3].includes(map.BathymetricZoneCodes[i]) || map.WaterDepths[i] < 400 * 1024) return true;
  for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
    const j = map.mesh.neighbors[i * map.mesh.stride + edge];
    if (j >= 0 && map.WaterKindCodes[j] !== 1) return true;
  }
  return false;
}
/** A ray below this intensity moves no water; it is the front rule's retained level. */
const frontThreshold = 160;
interface OceanForcing {
  upwelling: Float64Array;
  seaSurface: Float64Array;
  fog: Float64Array;
}
/** Upwelling, sea-surface forcing and fog source per ocean cell from every moving system. */
function movedWater(map: PhysicalField, fields: Field[]): OceanForcing {
  const n = map.mesh.count,
    forcing = {
      upwelling: new Float64Array(n),
      seaSurface: new Float64Array(n),
      fog: new Float64Array(n),
    };
  for (let i = 0; i < n; i++) {
    if (map.WaterKindCodes[i] !== 1) continue;
    const shoaling = shoals(map, i);
    for (const field of fields) {
      const e = field.definition.effects,
        lift = field.intensity[i] - frontThreshold;
      if (shoaling && lift > 0) {
        forcing.upwelling[i] += lift * e.upwelling;
        forcing.seaSurface[i] += lift * e.seaSurface;
        forcing.fog[i] = Math.max(forcing.fog[i], unit(lift / 400) * e.fog);
      } else if (field.wake[i] > 0 && field.intensity[i] > 0)
        forcing.seaSurface[i] += e.wakeWarming;
    }
    forcing.upwelling[i] = clamp(round(forcing.upwelling[i]), 0, 1000);
    // A front cools the surface by a few degrees, never into a sea of its own.
    forcing.seaSurface[i] = clamp(round(forcing.seaSurface[i]), -60, 60);
  }
  return forcing;
}
/** Fog settles on the land cells that touch an upwelling band. */
function settledFog(map: PhysicalField, source: Float64Array) {
  const fog = new Float64Array(map.mesh.count);
  for (let i = 0; i < fog.length; i++) {
    if (map.WaterKindCodes[i] !== 0) continue;
    for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
      const j = map.mesh.neighbors[i * map.mesh.stride + edge];
      if (j >= 0) fog[i] = Math.max(fog[i], source[j]);
    }
  }
  return fog;
}
/**
 * Pressure moves water. Where a ray shoals it lifts cold deep water: upwelling and a cold
 * sea surface, and fog on the coast it faces. A wake leaves a warm, still layer. The
 * forcing is written for the next climate pass and applied to the current fields at once,
 * replacing what an earlier evaluation applied.
 */
export function magicOceanFeedback(state: GenerationState) {
  const work = state.physical!,
    magic = work.magic!,
    map = work.map,
    fields = magic.fields.filter((field) => {
      const e = field.definition.effects;
      return field.definition.enabled && (e.upwelling || e.seaSurface || e.wakeWarming || e.fog);
    });
  // With no moving system left, one last pass clears whatever an earlier one applied.
  if (
    !fields.length &&
    !magic.upwelling.some(Boolean) &&
    !magic.seaSurface.some(Boolean) &&
    !magic.fog.some(Boolean)
  )
    return;
  const moved = movedWater(map, fields),
    fog = settledFog(map, moved.fog);
  for (let i = 0; i < map.mesh.count; i++) {
    map.ExternalUpwelling[i] = moved.upwelling[i];
    map.ExternalSeaSurfaceForcing[i] = moved.seaSurface[i];
    map.FogForcing[i] = fog[i];
    if (map.WaterKindCodes[i] === 1) {
      map.Upwelling[i] = clamp(
        round(map.Upwelling[i] + moved.upwelling[i] - magic.upwelling[i]),
        0,
        1000
      );
      const delta = moved.seaSurface[i] - magic.seaSurface[i];
      map.SeaSurfaceAnomaly[i] = round(map.SeaSurfaceAnomaly[i] + delta);
      map.Temperature[i] = clamp(round(map.Temperature[i] + delta), 0, 1000);
    }
    magic.upwelling[i] = moved.upwelling[i];
    magic.seaSurface[i] = moved.seaSurface[i];
    magic.fog[i] = fog[i];
  }
}
/**
 * Rock hardening and softening (existing), then the conduits: flowing Fire keeps its vein
 * open, so conductance rises each epoch it is active; a conduit that has carried its
 * budget seals with sinter and basalt, so conductance collapses and the vein beyond it
 * goes cold in the next epoch.
 */
export function magicRockFeedback(state: GenerationState) {
  const work = state.physical!,
    map = work.map,
    floor = work.profile.FractureConductanceFloor,
    fields = work.magic!.fields.filter((field) => field.definition.enabled),
    conduits = fields.filter((field) => field.definition.effects.conduitOpening > 0);
  for (let i = 0; i < map.mesh.count; i++) {
    let delta = 0;
    for (const field of fields)
      delta += (field.intensity[i] / 1000) * field.definition.effects.rockResistance;
    map.RockResistance[i] = rockResistance(map.RockResistance[i] + round(delta));
    if (map.WaterKindCodes[i] !== 1)
      for (const field of conduits) evolveConduit(map, field, i, floor);
  }
}
/** An active vein opens a little each epoch; one that has carried its budget seals. */
function evolveConduit(map: PhysicalField, field: Field, i: number, floor: number) {
  const intensity = field.intensity[i];
  if (field.sealed[i] > 0) {
    map.FractureConductance[i] = Math.min(map.FractureConductance[i], floor);
    return;
  }
  if (intensity < 230) return;
  if (field.history[i] + intensity >= field.definition.parameters.conduitBudget) {
    field.sealed[i] = 1;
    map.FractureConductance[i] = floor;
    return;
  }
  map.FractureConductance[i] = Math.min(
    1000,
    map.FractureConductance[i] + round((field.definition.effects.conduitOpening * intensity) / 1000)
  );
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
/**
 * Accumulate history and storage. Stored Aurora charge is what the next epoch's ice
 * model respects: the share of ablation it prevents is written here, from the charge
 * that will be present when that ice model runs.
 */
export function retainMagicHistory(state: GenerationState, context: MapProcessContext) {
  const map = state.physical!.map,
    index = coastalEpoch(context);
  map.IcePersistence.fill(0);
  // The next epoch's ice is new ice; its melt starts from nothing.
  state.physical!.magic!.melt.fill(0);
  for (const field of state.physical!.magic!.fields) {
    if (!field.definition.enabled) continue;
    const retention = field.definition.history,
      persistence = field.definition.effects.icePersistence;
    let active = 0,
      maximum = 0;
    for (let i = 0; i < map.mesh.count; i++) {
      const value = field.intensity[i];
      field.history[i] += value;
      // Only this epoch's own activity is stored; the charge carried in from earlier
      // epochs decays by retention instead of being stored again.
      field.stored[i] =
        field.stored[i] * retention.retention +
        Math.max(0, value - field.stored[i]) * retention.storage;
      if (value > 0 && field.firstEpoch[i] < 0) field.firstEpoch[i] = index;
      // Only the charge of a strong field (stored from intensities near the field rule's
      // seed level) holds ice; the wide cold drainage below that leaves ice to the climate.
      if (persistence > 0)
        map.IcePersistence[i] = Math.max(
          map.IcePersistence[i],
          persistence * unit((field.stored[i] - 300) / 150)
        );
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
