import { spatial } from "@atlas/domain";
import type { GenerationState, MapProcess } from "../process";
import { generationBindings } from "../generationBindings";
import { initializeMagic, magicKey, systemSeed, type MagicField } from "./magicState";
import { publishedMagicChannels, magicFieldDefinitions } from "./magicFieldDefinitions";
import { inheritMagicChannel } from "./magicInheritance";
import { nativePosition } from "./atlasWorkspace";
import { propagateMagic } from "./magicPropagation";
import { magicThermalFeedback, magicLivingFeedback, heldCharge } from "./magicFeedback";
import { classifyMagicFeatures, projectMagic } from "./magicFeatures";

function inheritInfluence(state: GenerationState, field: MagicField) {
  for (const channel of publishedMagicChannels)
    inheritMagicChannel(
      state,
      magicKey(field, channel),
      field[channel],
      magicFieldDefinitions[channel].quantity
    );
}
/** The parent temperature and ice already include these effects; replace only their local change. */
function rememberAppliedHeat(state: GenerationState) {
  const work = state.physical!,
    magic = work.magic!,
    map = work.map;
  for (const field of magic.fields)
    for (let i = 0; i < map.mesh.count; i++) {
      if (!field.definition.enabled) continue;
      const effects = field.definition.effects;
      magic.heat[i] +=
        field.intensity[i] * effects.heat * (effects.heat < 0 ? heldCharge(map, field, i) : 1);
      magic.melt[i] = Math.max(magic.melt[i], field.intensity[i] * effects.iceMelt);
    }
}
function refineInfluence(state: GenerationState, field: MagicField, seed: number) {
  if (!field.definition.enabled) return;
  // Ocean rays include historical rogue impulses and wake generation. Their inherited field
  // is the input here; firing that operation again would create another event at every depth.
  if (field.definition.origins.some((origin) => origin.propagation === "ocean-rays")) return;
  const hasOrigins = field.definition.origins.some(
    (origin) => state.surface.channels[magicKey(field, `origin:${origin.id}:source`)]
  );
  if (!hasOrigins) return; // Older saved maps retain their aggregate influence.
  const previous = field.intensity.slice(),
    interior = spatial.buffer(state.domain.scope.footprint, -(state.domain.scope.resolution ?? 0)),
    inside = interior ? spatial.pointCoverage(interior) : () => false;
  propagateMagic(state, field, systemSeed(seed, field.definition.id), field.definition.strength);
  for (let i = 0; i < previous.length; i++)
    if (!inside(nativePosition(state.physical!, i))) field.intensity[i] = previous[i];
}
/** Present propagation reads inherited source strengths, never calls renewal or stock advance. */
export function refineRegionalMagic(state: GenerationState, seed: number) {
  initializeMagic(state);
  const magic = state.physical!.magic!;
  for (const field of magic.fields) inheritInfluence(state, field);
  rememberAppliedHeat(state);
  refreshRegionalInfluence(state, seed);
}
export function refreshRegionalInfluence(state: GenerationState, seed: number) {
  const magic = state.physical!.magic!;
  const fields = [...magic.fields].sort(
    (a, b) => b.definition.effects.warding - a.definition.effects.warding
  );
  for (const field of fields) {
    refineInfluence(state, field, seed);
    if (field.definition.effects.warding) magicLivingFeedback(state);
  }
  magicThermalFeedback(state);
  magicLivingFeedback(state);
}
const operations = [
  {
    id: "regional.magic",
    requires: ["canonry:Temperature", "canonry:FlowRouting"],
    produces: ["atlas:magic-initialize"],
    apply: refineRegionalMagic,
  },
  {
    id: "regional.magic-map",
    requires: ["atlas:magic-initialize"],
    produces: ["atlas:magic-classify"],
    apply: (state: GenerationState, seed: number) => {
      classifyMagicFeatures(state, seed);
      projectMagic(state);
    },
  },
];
export const regionalMagicProcesses: MapProcess[] = operations.map(
  ({ id, requires, produces, apply }) => ({
    contract: {
      id,
      version: "1",
      parameters: {},
      requires: ["canonry:workspace", ...requires],
      produces,
      invalidates: [],
    },
    behavior: {
      kind: "model-pass",
      applyPass(state, context) {
        context.progress(0, "Refining inherited magical landscapes");
        apply(state, generationBindings(context).seed);
        context.progress(1, "Inherited magical geography ready");
      },
    },
    validate: () => [],
  })
);
