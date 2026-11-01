import type { Band, MagicSource } from "@atlas/domain";
import { evaluateConfluences } from "../../canonry/magicConfluences";
import {
  heldCharge,
  magicLivingFeedback,
  magicOceanFeedback,
  magicThermalFeedback,
} from "../../canonry/magicFeedback";
import { classifyMagicFeatures, projectMagic } from "../../canonry/magicFeatures";
import { propagateMagic } from "../../canonry/magicPropagation";
import {
  locateMagicSources,
  magicSourceStrategies,
  type SourceStrategy,
} from "../../canonry/magicSources";
import { inheritMagicChannel } from "../../canonry/magicInheritance";
import { initializeMagic, magicKey, systemSeed, type MagicField } from "../../canonry/magicState";
import type { PhysicalBufferName } from "../../canonry/field";
import type { RegionalState } from "../state";

/**
 * What the regional evaluation keeps between rounds: the captured source of every origin and
 * the captured intensity of every system, so a round re-derives the fields from the present
 * media without inventing a source or losing a ward the parent established.
 */
export interface MagicWork {
  capturedSources: Map<string, Map<string, Band>>;
  capturedIntensity: Map<string, Band>;
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
    work: MagicWork = { capturedSources: new Map(), capturedIntensity: new Map() };
  for (const field of magic.fields) {
    // The world inherits what travels with the crust; a refinement also starts from the
    // parent's present field, which it keeps where the engine does not re-derive it. A
    // disabled system's captured field stays zero.
    if (field.definition.enabled)
      for (const channel of ["intensity", "wake", "rogue"] as const)
        inheritMagicChannel(state, magicKey(field, channel), field[channel]);
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
      managesStock: true,
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
 * re-derives from the captured sources and the present medium. Returns the bands whose
 * applied total changed through the ledger (none in this delivery; the engine's own forcing
 * replaces its previous contribution itself).
 */
export function respondMagic(state: RegionalState): Map<PhysicalBufferName, number> {
  const magic = state.physical.magic,
    work = works.get(state);
  if (!magic || !work || !state.regional.input.domains.includes("magic")) return new Map();
  const seed = systemSeed(state.regional.input.seed, "regional"),
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
  evaluateConfluences(state, seed, false);
  return new Map();
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
  propagateMagic(state, field, seed, field.definition.strength);
  if (warding)
    for (let i = 0; i < field.intensity.length; i++)
      field.intensity.set(i, Math.max(field.intensity.get(i), captured.get(i)));
}

/** The present classes and their projection to the surface, once after the last round. */
export function mapMagic(state: RegionalState) {
  if (!state.physical.magic) return;
  classifyMagicFeatures(state, state.regional.input.seed);
  projectMagic(state);
}
