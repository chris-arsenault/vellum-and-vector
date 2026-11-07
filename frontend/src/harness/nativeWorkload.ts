import type { Epoch } from "@atlas/domain";
import { sequenceStages } from "../../../packages/generation/src/sequence";
import { atlasConfiguration } from "../../../packages/generation/src/atlasWorkflow";
import { allSteps } from "../../../packages/generation/src/world/physicalSteps";
import { draftWorldSnapshot, newGenerationDraft } from "../generationDraft";

/** Physical-only saved workloads follow the selected atlas operations, including their flags. */
export function nativeWorkload(epochs?: Epoch[]) {
  const draft = newGenerationDraft();
  if (epochs) draft.recipe.settings.epochs = epochs;
  const source = draftWorldSnapshot(draft),
    steps = new Map(allSteps.map((step) => [`atlas.${step[0]}`, step]));
  return sequenceStages(
    atlasConfiguration(source, {
      ...draft.recipe,
      areaId: source.scope.areaId,
      domains: ["physical"],
    }).sequence
  ).flatMap((stage) => {
    const step = steps.get(stage.invocation?.process ?? "");
    return step && stage.invocation ? [{ ...stage, step, invocation: stage.invocation }] : [];
  });
}
