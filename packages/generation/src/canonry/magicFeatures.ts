import { magicSurfaceCode, putChannel, surfaceRuleSources } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { MagicField } from "./magicState";
import { magicKey } from "./magicState";
import { classifyNaturalSurface } from "./naturalSurface";
import { projectedValues } from "./atlasSampling";
import { growRegion, ruleCoverage } from "./magicRegions";
import { activeConfluences, evaluateConfluences } from "./magicConfluences";
import {
  magicChannels,
  magicFieldDefinitions,
  publishedMagicChannels,
} from "./magicFieldDefinitions";

export function independentInteraction(
  rule: MagicField["definition"]["features"][number],
  owner: string
) {
  const conditions = [...rule.seeds, ...(rule.retains ?? [])].flat();
  const local = new Set<string>([...magicChannels, `system:${owner}`]);
  return (
    conditions.some((test) => test.field.startsWith("system:")) &&
    conditions.every((test) => !local.has(test.field))
  );
}
export function effectiveMagicRules(system: MagicField["definition"]) {
  return system.features.filter(
    (rule) => system.enabled || independentInteraction(rule, system.id)
  );
}
/**
 * Grow every effective rule of every system and measure its coverage. A system's coverage in
 * a cell is the most any of its classes occupies there. Confluences read this, so it runs
 * before them in each evaluation and again at classification.
 */
export function coverSystems(state: GenerationState, seed: number) {
  const magic = state.physical!.magic!;
  for (const field of magic.fields) {
    field.features = {};
    field.coverage = {};
    field.systemCoverage.fill(0);
    for (const rule of effectiveMagicRules(field.definition)) {
      const members = growRegion(state, field, rule, seed),
        coverage = ruleCoverage(state, field, rule, members, seed);
      field.features[rule.id] = members;
      field.coverage[rule.id] = coverage;
      for (let i = 0; i < coverage.length; i++)
        field.systemCoverage[i] = Math.max(field.systemCoverage[i], coverage[i]);
    }
  }
}
/**
 * The presentation raster: one code per cell, the highest-priority class among the systems'
 * rules and the confluences. The model beneath keeps every class and its coverage.
 */
export function classifyMagicFeatures(state: GenerationState, seed = state.domain.world.seed) {
  classifyNaturalSurface(state);
  const magic = state.physical!.magic!;
  coverSystems(state, seed);
  evaluateConfluences(state, seed, false);
  const priority = new Float64Array(magic.finalSurface.length).fill(-Infinity);
  const sources = surfaceRuleSources(
    magic.fields.map((field) => field.definition),
    magic.confluences.definitions
  );
  const paint = (
    code: number,
    rulePriority: number,
    members: Uint8Array,
    coverage?: Float64Array
  ) => {
    for (let i = 0; i < members.length; i++)
      if (members[i] && (coverage?.[i] ?? 1) > 0 && rulePriority > priority[i]) {
        magic.finalSurface[i] = code;
        priority[i] = rulePriority;
      }
  };
  for (const field of magic.fields)
    for (const rule of effectiveMagicRules(field.definition))
      paint(
        magicSurfaceCode(sources, field.definition.id, rule.id)!,
        rule.priority,
        field.features[rule.id],
        field.coverage[rule.id]
      );
  for (const held of Object.values(magic.confluences.states))
    paint(
      magicSurfaceCode(sources, "confluence", held.definition.id)!,
      held.definition.priority,
      held.members,
      held.coverage
    );
}
export function projectMagic(state: GenerationState) {
  const work = state.physical!,
    magic = work.magic;
  if (!magic) return;
  const project = (
    key: string,
    unit: string,
    values: ArrayLike<number>,
    quantity: "intensive" | "extensive" | "category"
  ) =>
    putChannel(state.surface, key, unit, projectedMagicValues(state, values, quantity), quantity);
  project("naturalSurface", "category", magic.naturalSurface, "category");
  project("finalSurface", "category", magic.finalSurface, "category");
  project("quickening", "ratio", work.map.Quickening, "intensive");
  project("stillness", "ratio", work.map.Stillness, "intensive");
  project("fog", "ratio", work.map.FogForcing, "intensive");
  project("icePersistence", "ratio", work.map.IcePersistence, "intensive");
  project("iceCharge", "ratio", work.map.IceCharge, "intensive");
  project("verdure", "ratio", work.map.Verdure, "intensive");
  project("salting", "ratio", work.map.Salting, "intensive");
  project("tenure", "person-year", work.map.Tenure, "extensive");
  project("walkedRoute", "traveller-year", work.map.WalkedRoute, "extensive");
  project("massDeath", "people", work.map.MassDeath, "extensive");
  project("magic:strain", "ratio", magic.confluences.strain, "intensive");
  for (const field of magic.fields) {
    for (const channel of publishedMagicChannels)
      project(
        magicKey(field, channel),
        magicFieldDefinitions[channel].unit,
        field[channel],
        magicFieldDefinitions[channel].quantity
      );
    project(magicKey(field, "coverage"), "ratio", field.systemCoverage, "intensive");
    for (const [key, values] of Object.entries(field.stocks))
      project(magicKey(field, `stock:${key}`), "intensity-square-metre", values, "extensive");
    for (const [id, members] of Object.entries(field.features)) {
      project(magicKey(field, `feature:${id}`), "category", members, "category");
      project(magicKey(field, `coverage:${id}`), "ratio", field.coverage[id], "intensive");
    }
  }
  for (const confluence of activeConfluences(state)) {
    const held = magic.confluences.states[confluence.id];
    if (!held) continue;
    project(`magic:confluence:${confluence.id}:members`, "category", held.members, "category");
    project(`magic:confluence:${confluence.id}:coverage`, "ratio", held.coverage, "intensive");
  }
}
function projectedMagicValues(
  state: GenerationState,
  values: ArrayLike<number>,
  quantity: "intensive" | "extensive" | "category"
) {
  const work = state.physical!;
  if (quantity !== "extensive" || !work.interpolation)
    return projectedValues(work, values, quantity === "category");
  const density = Float64Array.from(work.map.mesh.areas, (area, i) => values[i] / area);
  return projectedValues(work, density).map((value, i) => value * state.surface.measures[i]);
}
