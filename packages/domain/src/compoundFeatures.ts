import { z } from "zod";
import { featureInputSchema, uuid } from "./authoringSchemas";
import {
  evaluateFeature,
  featureRequirements,
  validateFeatureComposition,
  validateDependentContracts,
  type FeatureEdit,
} from "./featureIntents";
import { intentReads, type IntentRegistry, type IntentContext } from "./intent";
import type { ReadRequirements, DomainSnapshot, ChangeSet } from "./operations";
import { combineChanges, stagedSnapshot } from "./compoundChanges";
import { updateNetworkTopology } from "./networkTopology";

export function mergeFeatureRequirements(
  edits: FeatureEdit[],
  context: IntentContext
): ReadRequirements {
  const selections = edits.map((data) => featureRequirements(data, context));
  return intentReads(context, {
    objects: selections.flatMap((s) => s.objects),
    spatialLayers: [...new Set(selections.flatMap((s) => s.spatialLayers))],
    channels: mergeChannels(selections),
    references: [...new Set(selections.flatMap((s) => s.references ?? []))],
    completeRepresentations: [
      ...new Set(selections.flatMap((s) => s.completeRepresentations ?? [])),
    ],
    constraints: {
      intersectingAreas: true,
      descendantsOf: [],
      boundaryFeatures: edits.map((e) => e.feature.id),
    },
  });
}
function mergeChannels(selections: ReadRequirements[]): ReadRequirements["channels"] {
  const fields = new Map<string, Set<string>>();
  for (const selection of selections)
    for (const field of selection.channels) {
      const names = fields.get(field.fieldId) ?? new Set<string>();
      for (const name of field.names) names.add(name);
      fields.set(field.fieldId, names);
    }
  return [...fields].map(([fieldId, names]) => ({ fieldId, names: [...names] }));
}
export function evaluateFeatures(
  edits: FeatureEdit[],
  context: IntentContext,
  snapshot: DomainSnapshot
): ChangeSet {
  const parts: ChangeSet[] = [],
    batchContext = { ...context, introducedIds: edits.map((e) => e.feature.id) };
  let current = snapshot;
  for (const edit of edits) {
    const changes = evaluateFeature(edit, batchContext, current, { deferComposition: true });
    parts.push(changes);
    current = stagedSnapshot(current, changes);
  }
  const changes = combineChanges(context, snapshot, parts),
    affected = validateFeatureComposition(
      snapshot,
      changes,
      edits.map((e) => e.feature.id)
    );
  for (const edit of edits)
    validateDependentContracts(
      snapshot,
      current.world.areas[edit.areaId],
      current.world.features[edit.feature.id],
      changes,
      current.world
    );
  updateNetworkTopology(snapshot, changes, affected);
  return changes;
}
export function registerCompoundFeatureIntents(registry: IntentRegistry): void {
  registry.register({
    kind: "putFeatures",
    version: 1,
    description:
      "Author related features atomically through the same scoped geometry and domain rules.",
    schema: z.object({
      areaId: uuid,
      features: z
        .array(featureInputSchema)
        .min(1)
        .refine(
          (values) => new Set(values.map((f) => f.id)).size === values.length,
          "Each edited feature appears once."
        ),
    }),
    requirements: (data, context) =>
      mergeFeatureRequirements(
        data.features.map((feature) => ({ areaId: data.areaId, feature })),
        context
      ),
    evaluate: (data, context, snapshot) =>
      evaluateFeatures(
        data.features.map((feature) => ({ areaId: data.areaId, feature })),
        context,
        snapshot
      ),
  });
}
