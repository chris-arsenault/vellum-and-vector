import { useState } from "react";
import {
  projectGenerationSetup,
  type FeatureSelection,
  type GenerationSetup,
} from "@atlas/generation";
import type { DomainSnapshot } from "@atlas/domain";
import { projectInvalidDraft } from "./generationInvalidDraft";
import { cartographicFeatureStage } from "./cartographicDraft";
import {
  draftPreview,
  newGenerationDraft,
  normalizeGenerationDraft,
  updateFeature,
  type GenerationDraft,
} from "./generationDraft";

export type WorkflowStage = "world" | "land" | "environment" | "magic" | "people" | "review";
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
    const historyFixed =
      Boolean(previous?.context.inherited) ||
      Boolean(options.source?.world.generations.some((run) => run.domains.includes("physical")));
    return {
      draft,
      prepared: null,
      setup: projectInvalidDraft(draft, previous, historyFixed),
      error,
    };
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
  const [tuning, setTuning] = useState<string | null>(null);
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
      const epoch = field?.match(/^feature\..+\.epochs\.([^.]+)\./)?.[1];
      if (epoch) setEpoch(decodeURIComponent(epoch));
      const section = cartographicFeatureStage(id);
      setStage(options.source && section === "land" ? "environment" : section);
      setTuning(id);
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
    tuning,
    setTuning,
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
