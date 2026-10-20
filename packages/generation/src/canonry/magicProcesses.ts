import type { GenerationState, MapProcess, MapProcessContext } from "../process";
import { initializeMagic, systemSeed } from "./magicState";
import { locateMagicSources } from "./magicSources";
import { propagateMagic } from "./magicPropagation";
import {
  magicThermalFeedback,
  magicRockFeedback,
  magicCoastalFeedback,
  retainMagicHistory,
} from "./magicFeedback";
import { classifyMagicFeatures, projectMagic } from "./magicFeatures";

function evaluateMagic(
  state: GenerationState,
  context: MapProcessContext,
  phase: string,
  seed: number
) {
  const epoch =
    state.domain.world.epochs[context.epochIndices[0] ?? state.domain.world.epochs.length - 1];
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
    locateMagicSources(
      state,
      field,
      localSeed,
      context.epochIndices[0] ?? state.domain.world.epochs.length - 1
    );
    propagateMagic(
      state,
      field,
      localSeed,
      definition.strength * (epoch?.magicActivity?.[definition.id] ?? 1)
    );
  }
}
export function magicProcesses(seed: number, enabled: boolean): MapProcess[] {
  const actions: Record<string, (state: GenerationState, context: MapProcessContext) => void> = {
    initialize: (state) => {
      initializeMagic(state, enabled);
    },
    climate: (state, context) => {
      evaluateMagic(state, context, "climate", seed);
      magicThermalFeedback(state);
    },
    rocks: magicRockFeedback,
    "post-glacial": (state, context) => evaluateMagic(state, context, "post-glacial", seed),
    coast: magicCoastalFeedback,
    history: retainMagicHistory,
    classify: (state) => classifyMagicFeatures(state, seed),
    project: projectMagic,
  };
  return Object.entries(actions).map(([id, apply]) => ({
    contract: {
      id: `canonry.magic-${id}`,
      version: "0f62584c",
      parameters: {},
      requires: magicRequirements(id),
      produces: [`atlas:magic-${id}`],
      invalidates: [],
      workspaceOnly: id !== "project",
    },
    apply,
    validate: () => [],
  }));
}
function magicRequirements(id: string) {
  if (id === "initialize") return ["canonry:workspace"];
  const required = ["canonry:workspace", "atlas:magic-initialize"];
  if (id === "climate") required.push("canonry:Temperature");
  if (id === "rocks") required.push("atlas:magic-climate");
  if (id === "coast") required.push("atlas:magic-post-glacial");
  if (id === "project") required.push("atlas:magic-classify");
  return required;
}
