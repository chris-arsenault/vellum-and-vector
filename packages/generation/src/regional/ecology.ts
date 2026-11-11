import { accumulateOrganicMatter, buryOrganicMatter } from "../world/ecologyCarbon";
import { classifyBiome, environment, type EcologyForcing } from "../world/ecologyEnvironment";
import { canonicalPosition, ecologyEpochSchema, MapScale, spatial } from "@atlas/domain";
import { nativePosition } from "../world/atlasWorkspace";
import { initializeEcology } from "../world/ecologyEstablishment";
import { livingPlantCarbon } from "../world/ecologyGroups";
import { developVegetation } from "../world/ecologyVegetation";
import { authoritativeCanopy, updateTreeCover } from "../world/ecologyGrowth";
import { ecologicalForcing } from "../world/ecologyMagic";
import { erosionHistory } from "../world/ecologySoils";
import { ecologyScalars } from "@atlas/domain";
import { hashUnit } from "../world/noise";
import { generationFeatures } from "../generationFeatures";
import { magicHeat } from "./climate";
import { distance, isContent, positionOf, regionalSpan } from "./lattice";
import { seatRadius } from "./seats";
import { clamp, type RegionalState } from "./state";
import { generationBindings } from "../generationBindings";
import type { MapProcessContext } from "../process";
import { readEcologyEnvironment } from "../world/ecologyEnvironmentRead";
import { nativeContext } from "../world/context";

/** Fire causes: magic heat (°C), relative ignition-block span, its chance and a settlement edge's. */
const fireHeat = 3,
  fireBlock = MapScale.length(0.0025),
  fireChance = 0.35,
  seatFireChance = 0.2;

/**
 * Shared ecological response on the child's current climate and substrate. Exposure controls
 * local relaxation, not elapsed world history: canopy age and thermal maturity do not advance.
 * Soil water, organic recycling, toxicity, competition and animals use the shared owners.
 */
export function respondEcology(state: RegionalState, exposure: number, context: MapProcessContext) {
  if (!state.regional.input.domains.some((id) => id === "physical" || id === "magic")) return;
  if (exposure <= 0) return;
  const map = state.physical.map;
  readEcologyEnvironment(map, nativeContext(state, context, 0));
  const forcing = regionalForcing(state, context),
    restore = regionalAuthority(state);
  developVegetation(
    map,
    exposure,
    forcing,
    restore,
    state.regional.input.seed ^ state.regional.round
  );
  accumulateOrganicMatter(map, exposure, forcing);
  buryOrganicMatter(map);
}

/**
 * Once, before round one: preserve captured functional groups, cohorts, seeds and carbon.
 * Damage reference bands start at the inherited ground, so new erosion and burial act on
 * the child without repeating the parent's completed events.
 */
export function prepareEcology(state: RegionalState) {
  const map = state.physical.map;
  if (map.EcologyInitialized) return;
  initializeEcology(map, state.regional.input.seed, true);
  map.EcologyStillness.copyFrom(map.Stillness);
  rememberHistory(state);
}

/** Classify the current communities without growth, death, burial or water renewal. */
export function presentEcology(state: RegionalState, context: MapProcessContext) {
  const map = state.physical.map;
  readEcologyEnvironment(map, nativeContext(state, context, 0));
  for (let i = 0; i < map.mesh.count; i++)
    if (isContent(map.mesh, i)) map.BiomeCodes.set(i, classifyBiome(map, i));
}

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

/** Current configured ecology and magic, plus local ignition around developed terrain and places. */
function regionalForcing(
  state: RegionalState,
  context: MapProcessContext
): (i: number) => EcologyForcing {
  const bound = generationBindings(context),
    ecology = ecologyEpochSchema.parse(bound.settings.epochs.at(-1)?.ecology ?? {}),
    shared = ecologicalForcing(state, bound.parameters, ecology),
    ignite = fireCauses(state);
  return (i) => {
    const forcing = shared(i);
    forcing.fire += ignite[i];
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
    reference = state.domain.world.reference,
    bounds = spatial.bounds(reference.domain),
    woodland = new Uint8Array(map.mesh.count),
    fixed = work.fixed.filter(({ binding }) =>
      (ecologyScalars as readonly string[]).includes(binding.name)
    );
  for (const feature of generationFeatures(state, { areaId: state.regional.input.areaId })) {
    if (feature.kind !== "forest" || feature.state === "generated") continue;
    const covers = spatial.pointCoverage(feature.geometry);
    for (let i = 0; i < map.mesh.count; i++)
      if (covers(canonicalPosition(reference, nativePosition(work, i), bounds))) woodland[i] = 1;
  }
  return (i: number) => {
    for (const { binding, values } of fixed) {
      const value = values.get(i);
      if (Number.isFinite(value) && isMutablePhysicalName(binding.name))
        map[binding.name].set(i, value);
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

import { isMutablePhysicalName } from "../world/field";
