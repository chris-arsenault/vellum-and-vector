import type { Band, MagicSource } from "@atlas/domain";
import { evaluateConfluences } from "../../world/magicConfluences";
import {
  heldCharge,
  magicLivingFeedback,
  magicOceanFeedback,
  magicThermalFeedback,
} from "../../world/magicFeedback";
import { classifyMagicFeatures, coverSystems, projectMagic } from "../../world/magicFeatures";
import { propagateMagic } from "../../world/magicPropagation";
import { riverWarmth } from "../../world/riverWarmth";
import {
  declareConfluenceWrites,
  declareHallowedWrites,
  declareRockWrites,
  declareSaltWrites,
  declareVeilWrites,
  edgeFloor,
  holdIce,
  seedDoors,
} from "./writes";
import {
  locateMagicSources,
  magicSourceStrategies,
  type SourceStrategy,
} from "../../world/magicSources";
import { inheritMagicChannel } from "../../world/magicInheritance";
import { initializeMagic, magicKey, systemSeed, type MagicField } from "../../world/magicState";
import type { RegionalState } from "../state";

/**
 * What the regional evaluation keeps between rounds: the captured source of every origin and
 * the captured intensity of every system, so a round re-derives the fields from the present
 * media without inventing a source or losing a ward the parent established.
 */
export interface MagicWork {
  capturedSources: Map<string, Map<string, Band>>;
  capturedIntensity: Map<string, Band>;
  /** How far each cell stands inside the frame edge, 1 at the edge to 0 a parent span in. */
  edge: Float64Array;
  /** The doors the parent captured, per system: established evidence the pairing keeps. */
  capturedDoors: Map<string, { a: number; b: number }[]>;
}
const works = new WeakMap<RegionalState, MagicWork>();

/**
 * World locators that draw a budgeted count per reference area place at least one new source
 * on any map (`areaBudget` floors at one), and the history-reading ones renew stocks from
 * records a region does not carry. A region keeps the captured source of these origins.
 */
const budgeted = new Set<MagicSource>([
  "geothermal",
  "deep-ocean",
  "death",
  "dead-lake",
  "tenure",
  "kept-line",
]);
/** Hallowed wards the others and Veil reads them all; the rest follow the lore's order. */
const evaluationOrder = ["hallowed", "fire", "aurora", "pressure", "greenwood", "salt", "veil"];

/**
 * Build the world's magic workspace on the regional field from the captured channels, mark
 * the captured heat and melt as already applied (the captured temperature includes them),
 * and keep the captured sources and intensities the round evaluations start from.
 */
export function prepareMagic(state: RegionalState) {
  const enabled = state.regional.input.domains.includes("magic");
  initializeMagic(state, enabled);
  const magic = state.physical.magic!,
    work: MagicWork = {
      capturedSources: new Map(),
      capturedIntensity: new Map(),
      edge: edgeFloor(state),
      capturedDoors: new Map(),
    };
  for (const field of magic.fields) {
    // The world inherits what travels with the crust; a refinement also starts from the
    // parent's present field, which it keeps where the engine does not re-derive it. A
    // disabled system's captured field stays zero.
    if (field.definition.enabled)
      for (const channel of ["intensity", "wake", "rogue"] as const)
        inheritMagicChannel(state, magicKey(field, channel), field[channel]);
    // A system that pairs doors starts from the doors the parent captured.
    if (field.definition.enabled && field.definition.origins.some((o) => o.source === "pairing"))
      work.capturedDoors.set(field.definition.id, seedDoors(state, field));
    const origins = new Map<string, Band>();
    for (const [id, values] of Object.entries(field.originSources))
      origins.set(id, retainedCopy(state, values));
    work.capturedSources.set(field.definition.id, origins);
    work.capturedIntensity.set(field.definition.id, retainedCopy(state, field.intensity));
  }
  works.set(state, work);
  if (enabled) rememberAppliedHeat(state);
  return magic;
}
function retainedCopy(state: RegionalState, band: Band) {
  const copy = state.physical.map.coverage.copyBand(band);
  copy.retain();
  return copy;
}
/** The parent temperature and ice already include these effects; replace only their local change. */
function rememberAppliedHeat(state: RegionalState) {
  const work = state.physical,
    magic = work.magic!,
    map = work.map;
  for (const field of magic.fields) {
    if (!field.definition.enabled) continue;
    const effects = field.definition.effects;
    for (let i = 0; i < map.mesh.count; i++) {
      const intensity = field.intensity.get(i);
      magic.heat.add(
        i,
        intensity * effects.heat * (effects.heat < 0 ? heldCharge(map, field, i) : 1)
      );
      magic.melt.set(i, Math.max(magic.melt.get(i), intensity * effects.iceMelt));
    }
  }
}

/** The world's strategy table with the budgeted locators replaced by the captured source. */
function regionalStrategies(work: MagicWork, field: MagicField) {
  const captured = work.capturedSources.get(field.definition.id)!,
    table = { ...magicSourceStrategies } as Record<MagicSource, SourceStrategy>;
  for (const source of budgeted)
    table[source] = {
      ...magicSourceStrategies[source],
      locate(_state, located, _seed, context) {
        const kept = captured.get(context.origin.id);
        if (kept) located.source.copyFrom(kept);
      },
    };
  return table;
}

/**
 * One evaluation of the enabled systems against the shared media as they are now, with the
 * world engine's own locating, propagation, warding and shared forcing. Pressure's rays are
 * not retraced (the captured field stands; retracing would replay the ocean's impulses), a
 * captured ward does not spread again but stays, and nothing accumulates: every evaluation
 * re-derives from the captured sources and the present medium. The ground writes are declared
 * in the round's ledger cycle, which the schedule begins and commits (the engine's own forcing
 * replaces its previous contribution itself).
 */
export function respondMagic(state: RegionalState) {
  const magic = state.physical.magic,
    work = works.get(state);
  if (!magic || !work || !state.regional.input.domains.includes("magic")) return;
  const seed = systemSeed(state.regional.input.seed, "regional"),
    map = state.physical.map,
    fields = [...magic.fields]
      .filter((field) => field.definition.enabled)
      .sort((a, b) => order(a.definition.id) - order(b.definition.id));
  // A round's melt is owed once; the derived ice already carries the heat.
  magic.melt.fill(0);
  for (const field of fields) {
    evaluateField(state, work, field, systemSeed(seed, field.definition.id));
    if (field.definition.effects.warding) magicLivingFeedback(state);
  }
  magicThermalFeedback(state);
  magicLivingFeedback(state);
  magicOceanFeedback(state);
  // The classes' coverage, then the meetings that read it and take their share (the living
  // feedback above has marked the ward rim).
  coverSystems(state, seed);
  evaluateConfluences(state, seed, false);
  // What the systems and meetings do to the ground, as this evaluation's declared totals in
  // the round's ledger cycle (the schedule begins and commits it), so nothing accumulates (M5).
  declareRockWrites(state, work.capturedIntensity);
  declareConfluenceWrites(state, seed);
  declareHallowedWrites(state);
  declareVeilWrites(state);
  declareSaltWrites(state, state.regional.round <= 1);
  holdIce(state);
  // The applied heat is the forcing the river carries downstream (X6).
  for (let i = 0; i < map.mesh.count; i++)
    map.ExternalHeatForcing.set(i, Math.max(0, Math.round(magic.heat.get(i))));
  riverWarmth(map);
}
const order = (id: string) => {
  const index = evaluationOrder.indexOf(id);
  return index < 0 ? evaluationOrder.length : index;
};
function evaluateField(state: RegionalState, work: MagicWork, field: MagicField, seed: number) {
  const captured = work.capturedIntensity.get(field.definition.id)!,
    rays = field.definition.origins.some((origin) => origin.propagation === "ocean-rays"),
    warding = field.definition.effects.warding > 0;
  if (rays) {
    // The captured rays are the field; the coast's reflections re-form in a later delivery.
    field.intensity.copyFrom(captured);
    return;
  }
  locateMagicSources(state, field, seed, 0, regionalStrategies(work, field));
  // A captured door is established evidence: the engine's pairing drops a door whose ends
  // lost their tears, but the parent's doors stand (the pairing adds new ones beside them).
  for (const door of work.capturedDoors.get(field.definition.id) ?? [])
    if (!field.doors.some((d) => d.a === door.a && d.b === door.b)) field.doors.push(door);
  propagateMagic(state, field, seed, field.definition.strength);
  // A ward the parent established stays; every field keeps the captured intensity along the
  // frame edge, where the parent's country continues beyond it (X1).
  for (let i = 0; i < field.intensity.length; i++) {
    const floor = captured.get(i) * (warding ? 1 : work.edge[i]);
    if (floor > field.intensity.get(i)) field.intensity.set(i, floor);
  }
}

/** The present classes and their projection to the surface, once after the last round. */
export function mapMagic(state: RegionalState) {
  if (!state.physical.magic) return;
  classifyMagicFeatures(state, state.regional.input.seed);
  projectMagic(state);
}
