import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { initializeMagic, systemSeed } from "./magicState";
import { locateMagicSources, magicSourceStrategies } from "./magicSources";
import { propagateMagic, magicPropagationStrategies } from "./magicPropagation";
import {
  magicThermalFeedback,
  magicRockFeedback,
  magicCoastalFeedback,
  retainMagicHistory,
} from "./magicFeedback";
import { classifyMagicFeatures, effectiveMagicRules, projectMagic } from "./magicFeatures";
import { generationBindings } from "../generationBindings";
import type { ProcessBehavior } from "../processTraits";
import { ecologyLabels, type MagicSystem } from "@atlas/domain";

function evaluateMagic(
  state: GenerationState,
  context: MapProcessContext,
  phase: string,
  seed: number
) {
  const epochs = generationBindings(context).settings.epochs;
  const epoch = epochs[context.epochIndices[0] ?? epochs.length - 1];
  for (const field of state.physical!.magic!.fields) {
    const definition = field.definition;
    if (definition.phase !== phase) continue;
    if (!definition.enabled) {
      field.intensity.fill(0);
      field.source.fill(0);
      field.wake.fill(0);
      field.rogue.fill(0);
      continue;
    }
    const localSeed = systemSeed(seed, definition.id);
    locateMagicSources(state, field, localSeed, context.epochIndices[0] ?? epochs.length - 1);
    propagateMagic(
      state,
      field,
      localSeed,
      definition.strength * (epoch?.magicActivity?.[definition.id] ?? 1)
    );
  }
}
export function magicProcesses(systems: MagicSystem[] = []): MapProcess[] {
  const actions: Record<string, (state: GenerationState, context: MapProcessContext) => void> = {
    initialize: (state, context) => {
      const bound = generationBindings(context);
      initializeMagic(
        state,
        bound.features.selection["magic.configured"]?.enabled ?? bound.domains.includes("magic"),
        bound.settings.magicSystems
      );
    },
    climate: (state, context) => {
      evaluateMagic(state, context, "climate", generationBindings(context).seed);
      magicThermalFeedback(state);
    },
    rocks: magicRockFeedback,
    "post-glacial": (state, context) =>
      evaluateMagic(state, context, "post-glacial", generationBindings(context).seed),
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
  if (id === "climate") required.push("canonry:Temperature");
  if (id === "rocks") required.push("atlas:magic-climate");
  if (id === "coast") required.push("atlas:magic-post-glacial");
  if (id === "project") required.push("atlas:magic-classify");
  return [...new Set([...required, ...environmentalRequirements(id, systems)])];
}
function environmentalRequirements(id: string, systems: MagicSystem[]) {
  const selected = systems.filter((system) => system.enabled);
  if (["climate", "post-glacial"].includes(id))
    return selected.filter((system) => system.phase === id).flatMap(systemRequirements);
  if (id === "coast" && selected.some((system) => system.effects.coastalForcing !== 0))
    return ["canonry:Ocean", "canonry:OceanCurrents"];
  return id === "classify" ? systems.flatMap(conditionRequirements) : [];
}
function systemRequirements(system: MagicSystem) {
  return [
    ...magicSourceStrategies[system.source].requires,
    ...magicPropagationStrategies[system.propagation].requires,
  ];
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
  };
  return effectiveMagicRules(system)
    .flatMap((rule) => [...rule.seeds, ...(rule.retains ?? [])].flat())
    .flatMap((condition) =>
      Object.hasOwn(ecologyLabels, condition.field) ? ["ecology"] : (fields[condition.field] ?? [])
    );
}
