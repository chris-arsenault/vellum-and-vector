import type { GenerationState, MapProcessContext } from "../process";
import type { PhysicalField } from "./field";
import { clamp, rockResistance, round, units } from "./math";
import { Feature } from "./codes";
import { rebuild } from "./surface";
import { generationBindings } from "../generationBindings";
import { magicBudget, originStocks, reservoirStock } from "./magicState";
import { advanceStocks } from "./magicStocks";
import { rememberLakes } from "./magicSaltSources";
import { markRim, wardCoasts } from "./magicHallowed";
import type { Band, MagicSystem } from "@atlas/domain";
import { workingArray, releaseWorking } from "./physicalNumerics";

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
  const stored = field.stored.get(i),
    strength = Math.max((stored - 300) / 150, (field.intensity.get(i) - 600) / 300);
  // Relict charge in the ground keeps acting after the ice has gone, at a reduced strength,
  // so a deglaciated valley stays cold until the charge has thawed away.
  const relict = field.definition.parameters.relictStrength * unit((stored - 300) / 150);
  return unit(strength) * Math.max(unit(map.IceThickness.get(i) / 50), relict);
}
export function magicThermalFeedback(state: GenerationState) {
  const work = state.physical!,
    magic = work.magic!,
    map = work.map;
  for (let i = 0; i < map.mesh.count; i++) {
    let flags = map.FeatureFlags.get(i) & ~(Feature.FireCore | Feature.MagmaChamber);
    let heat = 0,
      melt = 0;
    for (const field of magic.fields) {
      if (!field.definition.enabled) continue;
      const effects = field.definition.effects,
        intensity = field.intensity.get(i);
      heat += intensity * effects.heat * (effects.heat < 0 ? heldCharge(map, field, i) : 1);
      melt += intensity * effects.iceMelt;
      if (effects.heat > 0 && field.source.get(i) > 0 && intensity > 0) {
        flags |= Feature.FireCore;
        if (intensity >= 940) flags |= Feature.MagmaChamber;
      }
    }
    map.FeatureFlags.set(i, flags);
    // Replace this contribution; later climate passes use the same external forcing.
    const previous = magic.heat.get(i),
      rounded = round(heat);
    magic.heat.set(i, rounded);
    map.ExternalHeatForcing.add(i, rounded - previous);
    map.Temperature.set(i, clamp(map.Temperature.get(i) - previous + rounded, 0, 1000));
    // Melt is a removal, not a level: within one epoch each cell loses at most the largest
    // melt any evaluation asked for, so the climate and post-glacial passes do not both melt.
    const ice = map.IceThickness.get(i),
      owed = Math.min(ice, Math.max(0, round(melt) - magic.melt.get(i)));
    magic.melt.set(i, Math.max(magic.melt.get(i), round(melt)));
    map.IceThickness.set(i, Math.max(0, ice - owed));
    // Ice melted from below pools under the glacier and leaves as meltwater: the runoff
    // pass cuts its outburst channels below the margin.
    if (owed > 0)
      map.GlacialMeltwater.set(i, clamp(map.GlacialMeltwater.get(i) + round(owed), 0, 1000));
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
      stillness = 0,
      verdure = 0,
      salting = 0,
      warding = 0,
      tearing = 0;
    for (const field of fields) {
      const share = field.intensity.get(i) / 1000;
      quickening += share * field.definition.effects.quickening;
      stillness += share * field.definition.effects.stillness * heldCharge(map, field, i);
      verdure += share * field.definition.effects.verdure;
      salting += share * field.definition.effects.salting;
      warding += share * field.definition.effects.warding;
      tearing += share * field.definition.effects.tearing;
    }
    map.Quickening.set(i, unit(quickening));
    map.Stillness.set(i, unit(stillness));
    map.Verdure.set(i, unit(verdure));
    map.Salting.set(i, unit(salting));
    map.Warding.set(i, unit(warding));
    map.Tearing.set(i, unit(tearing));
    // Greenwood divides the river that crosses it into wetland channels: the braided reach.
    const green = unit(verdure);
    if (green > 0.3 && map.RiverOrders.get(i) >= 1 && map.WaterKindCodes.get(i) === 0) {
      map.WetlandCover.set(i, Math.max(map.WetlandCover.get(i), 0.5 * green));
      map.FloodplainIntensity.set(i, Math.max(map.FloodplainIntensity.get(i), round(600 * green)));
    }
  }
  markRim(map, work.magic!);
}
/** Shelf, water shallower than 400 m, or a cell on the shore: where a ray lifts deep water. */
function shoals(map: PhysicalField, i: number) {
  if ([2, 3].includes(map.BathymetricZoneCodes.get(i)) || map.WaterDepths.get(i) < 400 * 1024)
    return true;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.WaterKindCodes.get(j) !== 1) return true;
  }
  return false;
}
/** A ray below this intensity moves no water; it is the front rule's retained level. */
const frontThreshold = 160;
interface OceanForcing {
  upwelling: Band;
  seaSurface: Band;
  fog: Band;
  storm: Band;
}
/** Upwelling, sea-surface forcing, fog source and storm energy per ocean cell from every moving system. */
function movedWater(map: PhysicalField, fields: Field[]): OceanForcing {
  const n = map.mesh.count,
    forcing = {
      upwelling: workingArray(map, "float64", "magic:water-upwelling"),
      seaSurface: workingArray(map, "float64", "magic:water-surface"),
      fog: workingArray(map, "float64", "magic:water-fog"),
      storm: workingArray(map, "float64", "magic:water-storm"),
    };
  for (let i = 0; i < n; i++) {
    if (map.WaterKindCodes.get(i) !== 1) continue;
    const shoaling = shoals(map, i);
    for (const field of fields) moveWaterAt(map, forcing, field, i, shoaling);
    forcing.upwelling.set(i, clamp(round(forcing.upwelling.get(i)), 0, 1000));
    // A front cools the surface by a few degrees, never into a sea of its own.
    forcing.seaSurface.set(i, clamp(round(forcing.seaSurface.get(i)), -60, 60));
    forcing.storm.set(i, clamp(round(forcing.storm.get(i)), 0, 1000));
  }
  return forcing;
}
/** One system's moved water at one ocean cell: a shoaling front lifts, a wake warms, both may storm. */
function moveWaterAt(
  map: PhysicalField,
  forcing: OceanForcing,
  field: Field,
  i: number,
  shoaling: boolean
) {
  const e = field.definition.effects,
    intensity = field.intensity.get(i),
    lift = intensity - frontThreshold,
    front = shoaling && lift > 0,
    wake = field.wake.get(i) > 0 && intensity > 0;
  if (front) {
    forcing.upwelling.add(i, lift * e.upwelling);
    forcing.seaSurface.add(i, lift * e.seaSurface);
    forcing.fog.set(i, Math.max(forcing.fog.get(i), unit(lift / 400) * e.fog));
  } else if (wake) forcing.seaSurface.add(i, e.wakeWarming);
  if ((front || wake) && e.storm > 0)
    forcing.storm.set(i, Math.max(forcing.storm.get(i), stormEnergy(map, field, i)));
}
/**
 * Storms are born on sharp warm fronts, as they cluster along the real warm currents: the
 * energy is the system's storm effect times how sharply the sea-surface anomaly turns at
 * the cell, raised where Fire heat stands in the air above it.
 */
function stormEnergy(map: PhysicalField, field: Field, i: number) {
  let front = 0;
  const anomaly = map.SeaSurfaceAnomaly.get(i);
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0) front = Math.max(front, Math.abs(anomaly - map.SeaSurfaceAnomaly.get(j)));
  }
  const sharpness = unit(front / field.definition.parameters.stormFrontGradient),
    fed = 1 + unit(Math.max(0, map.ExternalHeatForcing.get(i)) / 200);
  return 1000 * field.definition.effects.storm * sharpness * fed;
}
/** Fog settles on the land cells that touch an upwelling band. */
function settledFog(map: PhysicalField, source: Band) {
  const fog = workingArray(map, "float64", "magic:settled-fog");
  for (let i = 0; i < fog.length; i++) {
    if (map.WaterKindCodes.get(i) !== 0) continue;
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0) fog.set(i, Math.max(fog.get(i), source.get(j)));
    }
  }
  return fog;
}
function anyNonzero(band: Band) {
  for (let i = 0; i < band.length; i++) if (band.get(i)) return true;
  return false;
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
      return (
        field.definition.enabled &&
        (e.upwelling || e.seaSurface || e.wakeWarming || e.fog || e.storm)
      );
    });
  // With no moving system left, one last pass clears whatever an earlier one applied.
  if (
    !fields.length &&
    !anyNonzero(magic.upwelling) &&
    !anyNonzero(magic.seaSurface) &&
    !anyNonzero(magic.fog)
  )
    return;
  const moved = movedWater(map, fields),
    fog = settledFog(map, moved.fog);
  for (let i = 0; i < map.mesh.count; i++) {
    const upwelling = moved.upwelling.get(i),
      seaSurface = moved.seaSurface.get(i);
    map.ExternalUpwelling.set(i, upwelling);
    map.ExternalSeaSurfaceForcing.set(i, seaSurface);
    map.FogForcing.set(i, fog.get(i));
    map.StormForcing.set(i, moved.storm.get(i));
    if (map.WaterKindCodes.get(i) === 1) {
      map.Upwelling.set(
        i,
        clamp(round(map.Upwelling.get(i) + upwelling - magic.upwelling.get(i)), 0, 1000)
      );
      const delta = seaSurface - magic.seaSurface.get(i);
      map.SeaSurfaceAnomaly.set(i, round(map.SeaSurfaceAnomaly.get(i) + delta));
      map.Temperature.set(i, clamp(round(map.Temperature.get(i) + delta), 0, 1000));
    }
    magic.upwelling.set(i, upwelling);
    magic.seaSurface.set(i, seaSurface);
    magic.fog.set(i, fog.get(i));
  }
  releaseWorking(map, ...Object.values(moved), fog);
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
      delta += (field.intensity.get(i) / 1000) * field.definition.effects.rockResistance;
    map.RockResistance.set(i, rockResistance(map.RockResistance.get(i) + round(delta)));
    if (map.WaterKindCodes.get(i) !== 1)
      for (const field of conduits) evolveConduit(map, field, i, floor);
  }
}
/** An active vein opens a little each epoch; one that has carried its budget seals. */
function evolveConduit(map: PhysicalField, field: Field, i: number, floor: number) {
  const intensity = field.intensity.get(i);
  if (field.sealed.get(i) > 0) {
    map.FractureConductance.set(i, Math.min(map.FractureConductance.get(i), floor));
    return;
  }
  if (intensity < 230) return;
  if (field.history.get(i) + intensity >= field.definition.parameters.conduitBudget) {
    field.sealed.set(i, 1);
    map.FractureConductance.set(i, floor);
    // The conduit's cores stay in the rock as hardened ore.
    const origin = field.definition.origins.find((entry) => entry.renewal === "conduit-fed"),
      spent = origin && field.stocks[`${origin.id}/spent`],
      held = origin && field.stocks[`${origin.id}/${originStocks(origin)[0].id}`];
    if (spent && held) {
      spent.add(i, held.get(i));
      held.set(i, 0);
    }
    return;
  }
  map.FractureConductance.set(
    i,
    Math.min(
      1000,
      map.FractureConductance.get(i) +
        round((field.definition.effects.conduitOpening * intensity) / 1000)
    )
  );
}
/** The forcing one moving system puts on a shore cell from the sea beside it, or none. */
function shoreForcing(map: PhysicalField, field: Field, i: number) {
  const multiplier = field.definition.effects.coastalForcing;
  if (!multiplier) return 0;
  let pressure = 0,
    wave = 0,
    current = 0;
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j < 0 || map.WaterKindCodes.get(j) !== 1) continue;
    pressure = Math.max(pressure, field.intensity.get(j));
    wave = Math.max(wave, map.WaveExposure.get(j));
    current = Math.max(current, map.OceanCurrentStrength.get(j));
  }
  const p = field.definition.parameters;
  if (pressure < p.coastalThreshold) return 0;
  return clamp(
    round(
      (((pressure - p.coastalThreshold) * 1000) / (1000 - p.coastalThreshold) +
        wave * p.waveAmplification +
        current * p.currentAmplification) *
        multiplier
    ),
    1,
    1000
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
  const fields = magic.fields.filter((field) => field.definition.enabled),
    totals = workingArray(map, "float64", "magic:coastal-forcing");
  for (let i = 0; i < map.mesh.count; i++) {
    let total = 0;
    if (map.WaterKindCodes.get(i) === 0)
      for (const field of fields) {
        const forcing = shoreForcing(map, field, i);
        if (forcing <= 0) continue;
        total += forcing;
        field.coastalHistory.add(i, forcing);
        if (field.coastalFirstEpoch.get(i) < 0) field.coastalFirstEpoch.set(i, epoch);
      }
    totals.set(i, clamp(total, 0, 1000));
  }
  // A warded shore holds: its forcing moves to the shore downdrift before it is applied.
  wardCoasts(map, magic, totals);
  for (let i = 0; i < map.mesh.count; i++) {
    const total = totals.get(i);
    map.ExternalCoastalForcing.set(
      i,
      clamp(map.ExternalCoastalForcing.get(i) + total - magic.coastal.get(i), 0, 1000)
    );
    magic.coastal.set(i, total);
  }
  releaseWorking(map, totals);
}
/**
 * Thawing ground charge on bare land lets the ground settle, like thermokarst: a bounded
 * subsidence per cell that leaves the small closed basins Salt's dead lakes will read.
 */
function thawSubsidence(map: PhysicalField, field: Field, i: number, thawed: number) {
  if (thawed <= 0 || map.IceThickness.get(i) > 0 || map.WaterKindCodes.get(i) !== 0) return;
  const p = field.definition.parameters,
    room = p.thawSubsidenceLimit - field.subsided.get(i);
  if (room <= 0) return;
  const metres = Math.min(room, (p.thawSubsidence * thawed) / 1000);
  if (metres <= 0) return;
  field.subsided.add(i, metres);
  map.BedrockElevation.add(i, -units(metres));
  rebuild(map, i);
}
/**
 * Only the charge of a strong field (stored from intensities near the field rule's seed
 * level) holds ice; the wide cold drainage below that leaves ice to the climate. Charge the
 * glaciers calved onto a shelf holds the sea ice there.
 */
function holdIce(
  map: PhysicalField,
  field: Field,
  i: number,
  persistence: number,
  shelf: Band | undefined
) {
  const held = unit((field.stored.get(i) - 300) / 150),
    shelved =
      shelf && map.WaterKindCodes.get(i) === 1
        ? unit(shelf.get(i) / (map.mesh.area(i) * field.definition.parameters.shelfSaturation))
        : 0;
  map.IcePersistence.set(
    i,
    Math.max(map.IcePersistence.get(i), persistence * Math.max(held, shelved))
  );
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
  // The lakes of this epoch are remembered, so one that dies by the next is found by Salt.
  rememberLakes(map);
  for (const field of state.physical!.magic!.fields) {
    if (!field.definition.enabled) continue;
    advanceStocks(state, field, index);
    const retention = field.definition.history,
      persistence = field.definition.effects.icePersistence;
    let active = 0,
      maximum = 0;
    const shelf = reservoirStock(field, "shelf"),
      p = field.definition.parameters;
    for (let i = 0; i < map.mesh.count; i++) {
      const value = field.intensity.get(i),
        before = field.stored.get(i);
      field.history.add(i, value);
      // Only this epoch's own activity is stored; the charge carried in from earlier
      // epochs decays by retention instead of being stored again.
      const stored = before * retention.retention + Math.max(0, value - before) * retention.storage;
      field.stored.set(i, stored);
      if (value > 0 && field.firstEpoch.get(i) < 0) field.firstEpoch.set(i, index);
      if (p.thawSubsidence > 0) thawSubsidence(map, field, i, before - stored);
      if (persistence > 0) holdIce(map, field, i, persistence, shelf);
      if (map.mesh.membership(i) !== 1) continue;
      active += value > 0 ? map.mesh.area(i) : 0;
      maximum = Math.max(maximum, value);
    }
    const budget = magicBudget(field, map),
      km2 = (value: number) => Math.round(value / 1_000_000);
    context.recordCause({
      kind: "domain",
      process: "canonry.magic-history",
      subjects: [],
      description: `${field.definition.name}: epoch ${index + 1}, ${km2(active)} affected km², peak intensity ${maximum}; budget created ${km2(budget.created)}, in reservoirs ${km2(budget.carried)}, stored ${km2(budget.stored)}, released ${km2(budget.released)}, lost ${km2(budget.lost)} intensity·km²; accumulated activity, first occurrence and reservoirs travel with the crust.`,
    });
  }
}
