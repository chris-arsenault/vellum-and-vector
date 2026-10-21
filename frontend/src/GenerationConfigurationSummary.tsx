import type { SetupFeature } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { generationFeatureAdapter } from "./generationFeatureAdapters";

/** Review uses the same resolved settings that will be sent to the worker. */
export function GenerationConfigurationSummary({
  flow,
  feature,
}: {
  flow: GenerationWorkflow;
  feature: SetupFeature;
}) {
  const current = flow.prepared?.input.settings,
    previous = flow.baseline.prepared?.input.settings;
  if (!current || !previous) return null;
  const adapter = generationFeatureAdapter(feature.id);
  if (!adapter?.summarize) return null;
  const original = flow.baseline.setup?.features.find((entry) => entry.id === feature.id);
  const changes = adapter.summarize({
    current: feature.configuration,
    previous: original?.configuration,
    settings: current,
    baseline: previous,
  });
  if (!changes.length) return null;
  return (
    <dl className="setup-review-configuration">
      {changes.map((change, index) => (
        <div key={`${index}:${change.label}`}>
          <dt>{change.label}</dt>
          <dd>{change.value}</dd>
        </div>
      ))}
    </dl>
  );
}
