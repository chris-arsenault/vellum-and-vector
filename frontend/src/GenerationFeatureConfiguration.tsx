import type { SetupFeature } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { GenerationEpochConfiguration } from "./GenerationEpochConfiguration";
import { generationFeatureAdapter } from "./generationFeatureAdapters";

export function GenerationFeatureConfiguration({
  flow,
  feature,
}: {
  flow: GenerationWorkflow;
  feature: SetupFeature;
}) {
  const Editor = generationFeatureAdapter(feature.id)?.Editor ?? GenerationEpochConfiguration;
  return <Editor flow={flow} feature={feature} />;
}
