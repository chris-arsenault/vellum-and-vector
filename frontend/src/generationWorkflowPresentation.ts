import type { Diagnostic } from "@atlas/domain";
import type { SetupFeature } from "@atlas/generation";
import { updateFeature } from "./generationDraft";
import type { GenerationWorkflow, WorkflowStage } from "./useGenerationWorkflow";
import { physicalEpochControls } from "./generationEpochFields";
import { adapterFieldOwner, configurationFieldKey } from "./generationFeatureAdapters";

export const workflowStages: { id: WorkflowStage; title: string; question: string }[] = [
  { id: "world", title: "World", question: "Define the extent, detail and starting conditions." },
  {
    id: "land",
    title: "Land & materials",
    question: "Choose the mechanisms that construct and reshape the land.",
  },
  {
    id: "environment",
    title: "Water, climate & life",
    question: "Develop oceans, watersheds, ice and living landscapes.",
  },
  {
    id: "magic",
    title: "Magic & influences",
    question: "Define causal systems and the geography they affect.",
  },
  {
    id: "people",
    title: "People & places",
    question: "Choose cultural, political and built geography independently.",
  },
  {
    id: "review",
    title: "Review & generate",
    question: "Review the resolved geography and configuration before generation.",
  },
];
export function featureLabel(flow: GenerationWorkflow, id: string) {
  return flow.setup?.features.find((feature) => feature.id === id)?.label ?? id;
}
export function featureControlSettings(flow: GenerationWorkflow, id: string) {
  return (
    flow.setup?.features
      .flatMap((feature) => feature.settings)
      .filter((setting) => setting.controlFeature === id) ?? []
  );
}
export function enablePrerequisites(flow: GenerationWorkflow, feature: SetupFeature) {
  let draft = flow.draft;
  const visited = new Set<string>();
  const enable = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const definition = flow.setup?.features.find((entry) => entry.id === id);
    for (const required of definition?.requires ?? []) enable(required);
    draft = updateFeature(draft, id, { enabled: true });
  };
  for (const id of feature.requires) enable(id);
  flow.change(draft);
}
export function diagnosticFeature(flow: GenerationWorkflow, item: Diagnostic) {
  return (
    flow.setup?.features.find((feature) => feature.id === item.field?.feature) ??
    flow.setup?.features.find((feature) => feature.id === item.invocation) ??
    flow.setup?.features.find((feature) => feature.id === item.resource) ??
    flow.setup?.features.find((feature) =>
      feature.invocations.some((invocation) => item.invocation?.includes(invocation.id))
    )
  );
}
export function diagnosticField(flow: GenerationWorkflow, item: Diagnostic) {
  const field = item.field;
  if (!field) return undefined;
  const feature = flow.setup?.features.find((entry) => entry.id === field.feature);
  return feature
    ? configurationFieldKey(
        { ...feature, configuration: flow.draft.recipe.features?.[feature.id]?.configuration },
        field.path
      )
    : undefined;
}
export function diagnosticText(flow: GenerationWorkflow, item: Diagnostic) {
  let message = item.message;
  for (const feature of flow.setup?.features ?? [])
    message = message.replaceAll(feature.id, feature.label);
  return message;
}
export function stageStatus(
  flow: GenerationWorkflow,
  stage: WorkflowStage,
  errors: Record<string, string>
) {
  if (stage === "review") return reviewStatus(flow, errors);
  const features =
    flow.setup?.features.filter((feature) => feature.presentation.stage === stage) ?? [];
  if (
    features.some((feature) => feature.diagnostics.some((item) => item.severity === "error")) ||
    Object.keys(errors).some((key) => fieldStage(flow, key) === stage)
  )
    return "Needs attention";
  const edited = features.some(
    (feature) =>
      JSON.stringify(flow.draft.recipe.features?.[feature.id]) !==
        JSON.stringify(flow.baseline.draft.recipe.features?.[feature.id]) ||
      feature.enabled !==
        flow.baseline.setup?.features.find((entry) => entry.id === feature.id)?.enabled
  );
  if (edited || (stage === "world" && worldInputsChanged(flow))) return "Edited";
  return "Defaults";
}
function worldInputsChanged(flow: GenerationWorkflow) {
  const current = flow.draft,
    baseline = flow.baseline.draft;
  return (
    current.name !== baseline.name ||
    current.width !== baseline.width ||
    current.height !== baseline.height ||
    current.recipe.seed !== baseline.recipe.seed ||
    current.recipe.quality !== baseline.recipe.quality
  );
}
function reviewStatus(flow: GenerationWorkflow, errors: Record<string, string>) {
  const invalid =
    flow.error ||
    !flow.draft.name.trim() ||
    flow.json.dirty ||
    Object.keys(errors).length > 0 ||
    flow.prepared?.diagnostics.some((item) => item.severity === "error");
  return invalid ? "Needs attention" : "Ready to review";
}
function fieldStage(flow: GenerationWorkflow, key: string): WorkflowStage {
  return workflowFieldFeature(flow, key)?.presentation.stage ?? "world";
}
export function workflowFieldFeature(flow: GenerationWorkflow, key: string) {
  const known = adapterFieldOwner(key);
  if (known) return flow.setup?.features.find((feature) => feature.id === known);
  const physical = key.match(/^feature\.physical\.lifecycle\.epochs\.[^.]+\.(.+)$/);
  if (physical) {
    const owner = physicalFieldFeature(flow, physical[1]);
    if (owner) return owner;
  }
  return scalarFieldFeature(flow, key);
}
function scalarFieldFeature(flow: GenerationWorkflow, key: string) {
  const owner = flow.setup?.features.find((feature) => key.startsWith(`feature.${feature.id}.`));
  const setting = owner?.settings.find((setting) => key === `feature.${owner.id}.${setting.key}`);
  return flow.setup?.features.find((feature) => feature.id === setting?.controlFeature) ?? owner;
}
export function locateWorkflowField(flow: GenerationWorkflow, key: string) {
  const epoch = key.match(/^feature\..+\.epochs\.([^.]+)\./)?.[1];
  if (epoch) flow.setEpoch(decodeURIComponent(epoch));
  const feature = workflowFieldFeature(flow, key);
  if (feature) flow.locate(feature.id, key);
  else flow.setStage("world");
}
function physicalFieldFeature(flow: GenerationWorkflow, field: string) {
  const consumers =
    flow.setup?.features.filter((feature) =>
      physicalEpochControls(feature).some((control) => control.key === field)
    ) ?? [];
  return consumers.find((feature) => feature.enabled) ?? consumers[0];
}
