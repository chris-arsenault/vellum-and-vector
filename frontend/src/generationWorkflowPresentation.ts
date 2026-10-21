import type { Diagnostic } from "@atlas/domain";
import type { GenerationWorkflow, WorkflowStage } from "./useGenerationWorkflow";
import { physicalEpochControls } from "./generationEpochFields";
import { adapterFieldOwner, configurationFieldKey } from "./generationFeatureAdapters";

export const workflowStages: { id: WorkflowStage; title: string; question: string }[] = [
  { id: "world", title: "Map brief", question: "Define the map's extent and working detail." },
  { id: "land", title: "Land", question: "Choose the starting land and the events that shape it." },
  {
    id: "environment",
    title: "Landscape",
    question: "Set the climate and the character of water, ice and life.",
  },
  {
    id: "people",
    title: "People & places",
    question: "Choose cultural, political and built geography independently.",
  },
  {
    id: "review",
    title: "Review & generate",
    question: "Review the world you are about to generate.",
  },
];
export function featureControlSettings(flow: GenerationWorkflow, id: string) {
  return (
    flow.setup?.features
      .flatMap((feature) => feature.settings)
      .filter((setting) => setting.controlFeature === id) ?? []
  );
}
export function diagnosticFeature(flow: GenerationWorkflow, item: Diagnostic) {
  return (
    flow.setup?.features.find((feature) => feature.id === item.field?.feature) ??
    flow.setup?.features.find(
      (feature) => feature.id === item.invocation || feature.id === item.resource
    ) ??
    flow.setup?.features.find((feature) =>
      feature.invocationIds.some((id) => item.invocation?.includes(id))
    )
  );
}
export function diagnosticField(flow: GenerationWorkflow, item: Diagnostic) {
  if (!item.field) return undefined;
  const feature = flow.setup?.features.find((entry) => entry.id === item.field!.feature);
  return feature
    ? configurationFieldKey(
        {
          ...feature,
          configuration: flow.draft.recipe.features?.[feature.id]?.configuration,
        },
        item.field.path
      )
    : undefined;
}
export function diagnosticText(flow: GenerationWorkflow, item: Diagnostic) {
  let message = item.message;
  for (const feature of flow.setup?.features ?? [])
    message = message.replaceAll(feature.id, feature.label);
  return message;
}
export function workflowFieldFeature(flow: GenerationWorkflow, key: string) {
  const known = adapterFieldOwner(key);
  if (known) return flow.setup?.features.find((feature) => feature.id === known);
  const physical = key.match(/^feature\.physical\.lifecycle\.epochs\.[^.]+\.(.+)$/);
  if (physical) {
    const consumers =
      flow.setup?.features.filter((feature) =>
        physicalEpochControls(feature).some((control) => control.key === physical[1])
      ) ?? [];
    const owner = consumers.find((feature) => feature.enabled) ?? consumers[0];
    if (owner) return owner;
  }
  return scalarFieldFeature(flow, key);
}
function scalarFieldFeature(flow: GenerationWorkflow, key: string) {
  const owner = flow.setup?.features.find((feature) =>
    key.startsWith("feature." + feature.id + ".")
  );
  const setting = owner?.settings.find((entry) => key === "feature." + owner.id + "." + entry.key);
  return flow.setup?.features.find((feature) => feature.id === setting?.controlFeature) ?? owner;
}
export function locateWorkflowField(flow: GenerationWorkflow, key: string) {
  const epoch = key.match(/^feature\..+\.epochs\.([^.]+)\./)?.[1];
  if (epoch) flow.setEpoch(decodeURIComponent(epoch));
  const feature = workflowFieldFeature(flow, key);
  if (feature) flow.locate(feature.id, key);
  else flow.setStage("world");
}
