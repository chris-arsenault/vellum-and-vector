import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { initializeMagic, systemSeed, type MagicField } from "./magicState";
import { locateMagicSources, magicSourceStrategies } from "./magicSources";
import { propagateMagic, magicPropagationStrategies } from "./magicPropagation";
import {
  magicThermalFeedback,
  magicLivingFeedback,
  magicOceanFeedback,
  magicRockFeedback,
  magicCoastalFeedback,
  retainMagicHistory,
} from "./magicFeedback";
import {
  classifyMagicFeatures,
  coverSystems,
  effectiveMagicRules,
  projectMagic,
} from "./magicFeatures";
import { evaluateConfluences } from "./magicConfluences";
import { stormWrites } from "./magicWeather";
import { saltWrites } from "./magicSalt";
import { hallowedWrites } from "./magicHallowed";
import { veilWrites } from "./magicVeil";
import { generationBindings } from "../generationBindings";
import type { ProcessBehavior } from "../processTraits";
import { ecologyLabels, type Epoch, type MagicConfluence, type MagicSystem } from "@atlas/domain";

function evaluateMagic(
  state: GenerationState,
  context: MapProcessContext,
  phase: string,
  seed: number
) {
  const epochs = generationBindings(context).settings.epochs,
    index = context.epochIndices[0] ?? epochs.length - 1;
  for (const field of state.physical!.magic!.fields) {
    if (field.definition.phase === phase) evaluateField(state, field, seed, index, epochs[index]);
    else if (field.definition.enabled && phase === "climate") lapseToStoredCharge(field);
  }
}
function evaluateField(
  state: GenerationState,
  field: MagicField,
  seed: number,
  index: number,
  epoch: Epoch | undefined
) {
  const definition = field.definition;
  if (!definition.enabled) {
    field.intensity.fill(0);
    field.source.fill(0);
    field.wake.fill(0);
    field.rogue.fill(0);
    return;
  }
  const localSeed = systemSeed(seed, definition.id);
  locateMagicSources(state, field, localSeed, index);
  propagateMagic(
    state,
    field,
    localSeed,
    definition.strength * (epoch?.magicActivity?.[definition.id] ?? 1)
  );
}
/**
 * Between its own evaluations a system is present only as the charge it stored: the live
 * field of the last epoch went with that epoch's climate, and it re-forms in its own phase.
 */
function lapseToStoredCharge(field: MagicField) {
  for (let i = 0; i < field.intensity.length; i++)
    field.intensity[i] = Math.min(1000, Math.round(field.stored[i]));
}
function applySharedForcing(state: GenerationState) {
  magicThermalFeedback(state);
  magicLivingFeedback(state);
  magicOceanFeedback(state);
}
/**
 * The society phase: once people have acted in a cycle, systems made of what they did are
 * evaluated, and systems whose stocks people drew or deposited are located and propagated
 * again, then every system's shared forcing is re-applied. Without people it never runs, so
 * a world with no human era has no society-phase magic and the rest is unchanged.
 */
export function evaluateSocietyMagic(
  state: GenerationState,
  context: MapProcessContext,
  touched: Set<string> = new Set()
) {
  const bound = generationBindings(context),
    epochs = bound.settings.epochs,
    index = context.epochIndices[0] ?? epochs.length - 1;
  let changed = false;
  for (const field of state.physical!.magic!.fields) {
    const definition = field.definition;
    if (!definition.enabled || !(definition.phase === "society" || touched.has(definition.id)))
      continue;
    evaluateField(state, field, bound.seed, index, epochs[index]);
    changed = true;
  }
  if (!changed) return false;
  applySharedForcing(state);
  hallowedWrites(state);
  return true;
}
export function magicProcesses(
  systems: MagicSystem[] = [],
  confluences: MagicConfluence[] = []
): MapProcess[] {
  void confluences;
  const actions: Record<string, (state: GenerationState, context: MapProcessContext) => void> = {
    initialize: (state, context) => {
      const bound = generationBindings(context);
      initializeMagic(
        state,
        bound.features.selection["magic.configured"]?.enabled ?? bound.domains.includes("magic"),
        bound.settings.magicSystems,
        bound.settings.confluences
      );
    },
    // Every evaluation re-applies the shared forcings of all systems, so a system evaluated
    // in the other phase keeps its contribution and a changed one replaces its own.
    climate: (state, context) => {
      evaluateMagic(state, context, "climate", generationBindings(context).seed);
      applySharedForcing(state);
    },
    rocks: magicRockFeedback,
    // Both phases have run by now, so the meetings between systems are evaluated here and
    // act on the ground once per epoch, before ecology responds and the coasts are cut.
    "post-glacial": (state, context) => {
      const seed = generationBindings(context).seed;
      evaluateMagic(state, context, "post-glacial", seed);
      applySharedForcing(state);
      coverSystems(state, seed);
      evaluateConfluences(state, seed, true);
      stormWrites(state);
      saltWrites(state);
      hallowedWrites(state);
      veilWrites(state, context.epochIndices[0] ?? 0);
    },
    coast: magicCoastalFeedback,
    history: retainMagicHistory,
    classify: (state, context) => classifyMagicFeatures(state, generationBindings(context).seed),
    project: projectMagic,
  };
  return Object.entries(actions).map(([id, apply]) => ({
    contract: {
      id: `canonry.magic-${id}`,
      version: "0f62584c",
      parameters: {},
      requires: magicRequirements(id, systems),
      produces: [`atlas:magic-${id}`],
      invalidates: [],
      workspaceOnly: id !== "project",
    },
    behavior: magicBehavior(id, apply),
    validate: () => [],
  }));
}
function magicBehavior(
  id: string,
  operation: (state: GenerationState, context: MapProcessContext) => void
): ProcessBehavior {
  if (id === "initialize") return { kind: "initialize", initialize: operation };
  if (id === "project") return { kind: "extract", extract: operation };
  if (["climate", "rocks", "coast"].includes(id))
    return { kind: "forcing-contributor", contribute: operation };
  return { kind: "model-pass", applyPass: operation };
}
function magicRequirements(id: string, systems: MagicSystem[]) {
  if (id === "initialize") return ["canonry:workspace"];
  const required = ["canonry:workspace", "atlas:magic-initialize"];
  // Either evaluation re-applies every system's heat and melt, so both edit the climate
  // when a system carries those effects; a system that only moves water does not.
  if (
    ["climate", "post-glacial"].includes(id) &&
    systems.some((system) => system.enabled && (system.effects.heat || system.effects.iceMelt))
  )
    required.push("canonry:Temperature");
  if (id === "rocks") required.push("atlas:magic-climate");
  if (id === "coast") required.push("atlas:magic-post-glacial");
  if (id === "project") required.push("atlas:magic-classify");
  return [...new Set([...required, ...environmentalRequirements(id, systems)])];
}
function environmentalRequirements(id: string, systems: MagicSystem[]) {
  const selected = systems.filter((system) => system.enabled);
  if (["climate", "post-glacial"].includes(id)) {
    const required = selected.filter((system) => system.phase === id).flatMap(systemRequirements);
    // Moving water needs the ocean's geometry; the next circulation pass reads the forcing.
    if (selected.some((system) => system.effects.upwelling || system.effects.seaSurface))
      required.push("canonry:Ocean");
    return required;
  }
  if (id === "coast" && selected.some((system) => system.effects.coastalForcing !== 0))
    return ["canonry:Ocean", "canonry:OceanCurrents"];
  return id === "classify" ? systems.flatMap(conditionRequirements) : [];
}
function systemRequirements(system: MagicSystem) {
  return system.origins.flatMap((origin) => [
    ...magicSourceStrategies[origin.source].requires,
    ...magicPropagationStrategies[origin.propagation].requires,
  ]);
}
function conditionRequirements(system: MagicSystem) {
  const fields: Record<string, string[]> = {
    elevation: ["canonry:Elevation"],
    slope: ["canonry:Elevation"],
    temperature: ["canonry:Temperature"],
    ice: ["canonry:LandIce"],
    water: ["canonry:Ocean", "canonry:Lakes"],
    moisture: ["canonry:Moisture"],
    geothermal: ["canonry:Geothermal"],
    fracture: ["canonry:FractureState"],
    landform: ["canonry:Landforms"],
    river: ["canonry:Rivers"],
    upwelling: ["canonry:OceanCurrents"],
  };
  return effectiveMagicRules(system)
    .flatMap((rule) => [...rule.seeds, ...(rule.retains ?? [])].flat())
    .flatMap((condition) =>
      Object.hasOwn(ecologyLabels, condition.field) ? ["ecology"] : (fields[condition.field] ?? [])
    );
}
