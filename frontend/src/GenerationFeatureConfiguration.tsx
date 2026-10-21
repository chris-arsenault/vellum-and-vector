import type { SetupFeature } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import {
  GenerationEpochConfiguration,
  GenerationEcologyConfiguration,
} from "./GenerationEpochConfiguration";
import {
  GenerationMagicConfiguration,
  GenerationLocatedSources,
} from "./GenerationMagicConfiguration";
import { GenerationCultureConfiguration } from "./GenerationCultureConfiguration";

export function GenerationFeatureConfiguration({
  flow,
  feature,
}: {
  flow: GenerationWorkflow;
  feature: SetupFeature;
}) {
  if (feature.id === "physical.lifecycle")
    return (
      <p className="hint">
        Use the shared history above to edit epoch names, order and durations. Each feature
        configures its response to that same history.
      </p>
    );
  if (feature.id === "ecology.living")
    return <GenerationEcologyConfiguration flow={flow} feature={feature} />;
  if (feature.id === "magic.configured")
    return <GenerationMagicConfiguration flow={flow} feature={feature} />;
  if (feature.id === "magic.local") return <GenerationLocatedSources flow={flow} />;
  if (feature.id === "human.cultures")
    return <GenerationCultureConfiguration flow={flow} feature={feature} />;
  return <GenerationEpochConfiguration flow={flow} feature={feature} />;
}
