import { accumulateOrganicMatter } from "../world/ecologyCarbon";
import { disturbEcology, floodEcology } from "../world/ecologyDisturbance";
import {
  classifyBiome,
  environment,
  neutralEcology,
  type EcologyForcing,
} from "../world/ecologyEnvironment";
import { MapScale, spatial } from "@atlas/domain";
import { nativePosition } from "../world/atlasWorkspace";
import { dispersePlants, initializeEcology } from "../world/ecologyEstablishment";
import { livingPlantCarbon, plantGroups } from "../world/ecologyGroups";
import {
  authoritativeCanopy,
  growCommunities,
  normalizeCommunities,
  updateTreeCover,
} from "../world/ecologyGrowth";
import { ecologicalMagicEffectBindings, ecologicalMagicEffects } from "../world/ecologyProcesses";
import { erosionHistory, evolveSoils } from "../world/ecologySoils";
import { ecologyScalars } from "../world/ecologyState";
import { heldCharge } from "../world/magicFeedback";
import { hashUnit } from "../world/noise";
import { generationFeatures } from "../generationFeatures";
import { capturedCelsius, magicHeat } from "./glacial";
import { distance, isContent, positionOf, regionalSpan } from "./lattice";
import { seatRadius } from "./seats";
import { clamp, naturalBand, type RegionalState } from "./state";

/** Development horizon (years) per round: a broadleaf lifespan, a coupled response, young regrowth. */
const horizons = [250, 60, 20];
/** Captured temperatures (°C) at and above which the tree cover is all conifer, and none. */
const allConifer = 2,
  noConifer = 8;
/** A captured canopy younger than this (years) is still saplings in part. */
const youngCanopy = 40;
/** Seed a group holds wherever its cover is present, as a share of that cover. */
const seedFromPresence = 0.2;
/** Relative water depths the wetness medium and channel margin add to captured supply. */
const wetnessSupply = MapScale.length(5e-8),
  riparianSupply = MapScale.length(7.5e-8);
/** Fire causes: magic heat (°C), relative ignition-block span, its chance and a settlement edge's. */
const fireHeat = 3,
  fireBlock = MapScale.length(0.0025),
  fireChance = 0.35,
  seatFireChance = 0.2;

/**
 * The world ecology engine on the regional field (plan M4). The host supplies what the
 * world's process wrappers supplied: the initializer from the capture, the forcing from the
 * field's magic bands and the fire causes, the authority (the engine's own tree-cover update),
 * and the round's horizon. The engine's steps run in its own order.
 */
export function respondEcology(state: RegionalState) {
  if (!state.regional.input.domains.some((id) => id === "physical" || id === "magic")) return;
  const map = state.physical.map,
    mesh = map.mesh,
    years = horizons[state.regional.round - 1] ?? 0,
    forcing = regionalForcing(state),
    restore = regionalAuthority(state);
  if (years > 0) {
    // Round one's relief is the derivation, not a change since the capture: the history
    // memory starts at it, so soil damage reads this run's own ice and incision from here on.
    if (state.regional.round === 1) rememberHistory(state);
    evolveSoils(map, years, forcing);
    // The ground's water supply after the soils evolved: what the growing cover reads.
    supplySoilWater(state);
    disturbEcology(map, years, forcing, state.regional.input.seed ^ state.regional.round);
    floodEcology(map, years);
    growCommunities(map, years, dispersePlants(map, years, forcing), forcing, restore);
    accumulateOrganicMatter(map, years, forcing);
  } else supplySoilWater(state);
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    const env = environment(map, i, forcing(i));
    if (env.frozen || env.submerged) drown(map, i);
    normalizeCommunities(map, i);
    updateTreeCover(map, i);
    map.BiomeCodes.set(i, classifyBiome(map, i, env));
  }
  rememberHistory(state);
}

/**
 * Once, before round one: the engine's inheritance of functional groups, then the cohorts
 * from the capture (conifer share by captured temperature, saplings by canopy age, seeds by
 * presence); soils and carbon stand as captured. The history memory starts at the captured
 * state, so soil damage reads this run's own ice and incision.
 */
export function prepareEcology(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh;
  if (map.EcologyInitialized) return;
  // The captured soil water is the baseline the supply adds to, kept before the engine's
  // soil step first writes the band.
  naturalBand(state, "SoilWater");
  initializeEcology(map, state.regional.input.seed, true);
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    const trees = map.TreeCover.get(i),
      conifer = clamp((noConifer - capturedCelsius(state, i)) / (noConifer - allConifer)),
      // A parent that published no canopy age (zero) describes a mature canopy, not a new one.
      age = map.CanopyAge.get(i),
      young = age > 0 ? clamp(1 - age / youngCanopy) : 0;
    map.ConiferCover.set(i, trees * conifer * (1 - young));
    map.BroadleafCover.set(i, trees * (1 - conifer) * (1 - young));
    map.ConiferSaplings.set(i, trees * conifer * young);
    map.BroadleafSaplings.set(i, trees * (1 - conifer) * young);
    // Seeds by presence, over the floor every group holds wherever it could grow (the world's
    // founders give the same floors, with a noise the region has no need of).
    for (const group of plantGroups)
      map[group.seed].set(
        i,
        Math.max(
          map[group.seed].get(i),
          seedFloor[group.id] ?? 0,
          seedFromPresence * map[group.cover].get(i)
        )
      );
  }
  rememberHistory(state);
}
const seedFloor: Record<string, number> = {
  grass: 0.15,
  broadleaf: 0.08,
  conifer: 0.08,
  wetland: 0.02,
};

/** The engine's history memory set to the present, so the next step's damage is the change since. */
function rememberHistory(state: RegionalState) {
  const map = state.physical.map;
  for (let i = 0; i < map.mesh.count; i++) {
    map.EcologySediment.set(i, MapScale.metres(map.SedimentThickness.get(i), "native"));
    map.EcologyVolcanic.set(i, MapScale.metres(map.VolcanicConstructionHistory.get(i), "native"));
    map.EcologyImpact.set(i, MapScale.metres(map.ImpactExcavation.get(i), "native"));
    map.EcologyErosion.set(i, erosionHistory(map, i));
    map.EcologyIce.set(i, map.IceThickness.get(i));
  }
}

/** The captured soil water, raised where the ground gathers water and along the channels. */
function supplySoilWater(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    natural = naturalBand(state, "SoilWater"),
    wetness = state.regional.media?.wetness;
  for (let i = 0; i < mesh.count; i++) {
    if (!isContent(mesh, i)) continue;
    // The ground holds no more than its soil can: the engine's capacity for the soil depth.
    const capacity = Math.max(map.scale.length(1.25e-8), soilCapacity * map.SoilDepth.get(i));
    map.SoilWater.set(
      i,
      Math.min(
        capacity,
        natural.get(i) +
          map.scale.resolveMeasure(wetnessSupply) * (wetness?.[i] ?? 0) +
          (map.scale.resolveMeasure(riparianSupply) * map.FloodplainIntensity.get(i)) / 1000
      )
    );
  }
}
/** Soil water (m) a metre of soil holds at most, as the engine's soil step has it. */
const soilCapacity = 0.27;

/** Neutral forcing plus the field's magic bands and the round's fire causes. */
function regionalForcing(state: RegionalState): (i: number) => EcologyForcing {
  const map = state.physical.map,
    ignite = fireCauses(state),
    fields = (state.physical.magic?.fields ?? []).filter((field) => field.definition.enabled);
  return (i) => {
    // Each system's ecological effects by its intensity, through the held-charge gate the
    // world's bindings use; the shared bands the feedback wrote come as they are.
    const forcing: EcologyForcing = {
      ...neutralEcology,
      quickening: map.Quickening.get(i),
      stillness: map.Stillness.get(i),
      verdure: map.Verdure.get(i),
      salting: map.Salting.get(i),
      fire: ignite[i],
    };
    for (const field of fields) {
      const intensity = (field.intensity.get(i) / 1000) * heldCharge(map, field, i);
      for (const effect of ecologicalMagicEffects)
        forcing[ecologicalMagicEffectBindings[effect]] +=
          intensity * field.definition.effects[effect];
    }
    return forcing;
  };
}

/**
 * The regional authority over cover: the world's own tree-cover update, with authored forest
 * polygons of this map held at woodland and the fixed (authored) ecology channels held at
 * their values, as the world's cover authority does.
 */
function regionalAuthority(state: RegionalState) {
  const work = state.physical,
    map = work.map,
    woodland = new Uint8Array(map.mesh.count),
    fixed = work.fixed.filter(({ binding }) =>
      (ecologyScalars as readonly string[]).includes(binding.native)
    );
  for (const feature of generationFeatures(state, { areaId: state.regional.input.areaId })) {
    if (feature.kind !== "forest" || feature.state === "generated") continue;
    const covers = spatial.pointCoverage(feature.geometry);
    for (let i = 0; i < map.mesh.count; i++) if (covers(nativePosition(work, i))) woodland[i] = 1;
  }
  return (i: number) => {
    for (const { binding, values } of fixed) {
      const value = values.get(i);
      if (Number.isFinite(value) && isMutablePhysicalName(binding.native))
        map[binding.native].set(i, value);
    }
    if (woodland[i]) authoritativeCanopy(map, i, Math.max(0.7, map.TreeCover.get(i)));
    else updateTreeCover(map, i);
  };
}

/**
 * Where fire starts (plan: cause-keyed ignition): ground under magic heat, the driest
 * best-fuelled cell of each block by one stable keyed draw, and a settlement's edge by
 * another. The engine's own background ignition remains inside its rule.
 */
function fireCauses(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    seed = state.regional.input.seed ^ Math.imul(state.regional.round + 1, 0x5a11),
    ignite = new Uint8Array(mesh.count);
  for (let i = 0; i < mesh.count; i++)
    if (burnable(state, i) && magicHeat(state, i) >= fireHeat) ignite[i] = 1;
  for (const [block, { cell, risk }] of driestFuel(state))
    if (risk > 0.05 && hashUnit(seed, block, 0) < fireChance) ignite[cell] = 1;
  igniteSeatEdges(state, ignite, seed);
  return ignite;
}
/** Ground that can burn: a content land cell not under ice. */
function burnable(state: RegionalState, i: number) {
  const map = state.physical.map;
  return (
    isContent(map.mesh, i) &&
    map.WaterKindCodes.get(i) === 0 &&
    map.IceThickness.get(i) < map.scale.length(2.5e-7)
  );
}
/** The driest best-fuelled land cell of each block, with its risk (drought times fuel). */
function driestFuel(state: RegionalState) {
  const map = state.physical.map,
    mesh = map.mesh,
    blockSpan = map.scale.resolveMeasure(fireBlock),
    driest = new Map<number, { cell: number; risk: number }>(); // hpc-exempt: one entry per ignition block
  for (let i = 0; i < mesh.count; i++) {
    if (!burnable(state, i)) continue;
    const fuel = clamp(livingPlantCarbon(map, i) / 5);
    if (fuel <= 0.05) continue;
    const p = positionOf(mesh, i),
      block = Math.floor(p.x / blockSpan) * 4096 + Math.floor(p.y / blockSpan),
      risk = environment(map, i).drought * fuel,
      best = driest.get(block);
    if (!best || risk > best.risk) driest.set(block, { cell: i, risk });
  }
  return driest;
}
/** A settlement's edge: the ring just outside its footprint, with one keyed draw per seat. */
function igniteSeatEdges(state: RegionalState, ignite: Uint8Array, seed: number) {
  const mesh = state.physical.map.mesh,
    span = regionalSpan(state),
    radius = seatRadius(state);
  for (const seat of state.regional.evidence?.seats ?? []) {
    if (hashUnit(seed ^ 0x3e7, seat.cell, 1) >= seatFireChance) continue;
    for (let i = 0; i < mesh.count; i++) {
      const d = distance(mesh, seat.cell, i);
      if (d > radius * span && d <= (radius + 1) * span && burnable(state, i)) ignite[i] = 1;
    }
  }
}

/** Cover under new sea, lake or ice dies at once; its litter goes to the soil. */
function drown(map: RegionalState["physical"]["map"], i: number) {
  const before = livingPlantCarbon(map, i);
  for (const group of plantGroups) {
    map[group.cover].set(i, 0);
    if (group.juvenile) map[group.juvenile].set(i, 0);
  }
  map.SoilCarbon.add(i, before);
}
import { isMutablePhysicalName } from "../world/field";
