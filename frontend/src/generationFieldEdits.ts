import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { workflowFieldFeature } from "./generationWorkflowPresentation";

/** Omission discards inactive raw edits, while retaining shared physical clock values. */
export function discardFeatureFieldEdits(
  flow: GenerationWorkflow,
  id: string,
  fields: {
    errors: Record<string, unknown>;
    clearExact(key: string): void;
  }
) {
  for (const key of Object.keys(fields.errors)) {
    if (key.startsWith("feature.physical.lifecycle.epochs.")) continue;
    if (workflowFieldFeature(flow, key)?.id === id) fields.clearExact(key);
  }
}
