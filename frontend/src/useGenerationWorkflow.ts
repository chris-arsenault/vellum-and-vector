import { useState } from "react";
import {
  projectGenerationSetup,
  type FeatureSelection,
  type GenerationSetup,
  type GenerationSetupStage,
} from "@atlas/generation";
import type { DomainSnapshot } from "@atlas/domain";
import {
  draftPreview,
  newGenerationDraft,
  normalizeGenerationDraft,
  updateFeature,
  type GenerationDraft,
} from "./generationDraft";

export type WorkflowStage = GenerationSetupStage | "review";
export type PreparedSetup = ReturnType<typeof draftPreview>;
export interface GenerationWorkflowOptions {
  initial?: GenerationDraft;
  source?: DomainSnapshot;
  areaId?: string;
  onGenerate(draft: GenerationDraft, prepared: PreparedSetup): void | Promise<void>;
  onManual?(draft: GenerationDraft): void | Promise<void>;
  onCancel?(): void;
}
interface DraftView {
  draft: GenerationDraft;
  prepared: PreparedSetup | null;
  setup: GenerationSetup | null;
  error: unknown;
}
function resolveDraft(
  draft: GenerationDraft,
  options: GenerationWorkflowOptions,
  previous: GenerationSetup | null = null
): DraftView {
  try {
    const prepared = draftPreview(draft, options.source, options.areaId);
    return { draft, prepared, setup: projectGenerationSetup(prepared), error: null };
  } catch (error) {
    // Keep the editors reachable while an invalid nested configuration is repaired.
    return { draft, prepared: null, setup: previous, error };
  }
}
export function useGenerationWorkflow(options: GenerationWorkflowOptions) {
  const [view, setView] = useState(() =>
    resolveDraft(
      normalizeGenerationDraft(options.initial ?? newGenerationDraft(), options.source),
      options
    )
  );
  const [stage, setStage] = useState<WorkflowStage>("world");
  const [baseline] = useState(view);
  const [target, setTarget] = useState<string | null>(null);
  const [targetField, setTargetField] = useState<string | undefined>();
  const [targetRevision, setTargetRevision] = useState(0);
  const [epoch, setEpoch] = useState("");
  const [approach, setApproach] = useState<"procedural" | "blank">("procedural");
  const [json, setJson] = useState<{ text: string; dirty: boolean }>({ text: "", dirty: false });
  const change = (draft: GenerationDraft) =>
    setView((previous) => resolveDraft(draft, options, previous.setup));
  const feature = (id: string, patch: FeatureSelection[string]) =>
    change(updateFeature(view.draft, id, patch));
  const locate = (id: string, field?: string) => {
    const target = view.setup?.features.find((entry) => entry.id === id);
    if (target) {
      setStage(target.presentation.stage);
      setTarget(id);
      setTargetField(field);
      setTargetRevision((value) => value + 1);
    }
    return target;
  };
  return {
    ...view,
    baseline,
    target,
    targetField,
    targetRevision,
    stage,
    setStage,
    epoch,
    setEpoch,
    approach,
    setApproach,
    json,
    setJson,
    change,
    feature,
    locate,
    options,
  };
}
export type GenerationWorkflow = ReturnType<typeof useGenerationWorkflow>;
