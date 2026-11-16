import { useEffect, useRef, useState } from "react";
import type { GenerationAction, GenerationService, RealScaleChoice } from "@atlas/context";
import type { MapDescriptor, RegionSelection } from "@atlas/map";
import type { Diagnostic, Landmark, LocatedMagicSource } from "@atlas/context";
import type { FeatureSelection, GenerationSetup, AtlasGenerationInput } from "./generationTypes";
import { cartographicFeatureStage } from "./cartographicDraft";
import { updateFeature, type GenerationDraft } from "./generationDraft";
import { projectInvalidDraft } from "./generationInvalidDraft";

export type WorkflowStage = "world" | "land" | "environment" | "magic" | "people" | "review";
export interface PreparedSetup {
  input: AtlasGenerationInput;
  setup: GenerationSetup;
  diagnostics: Diagnostic[];
  cartography: Record<string, string | null>;
  landmarks: Landmark[];
  sources: LocatedMagicSource[];
  resolutions: import("./GenerationResolution").Resolution[];
}
export interface GenerationWorkflowOptions {
  initial: GenerationDraft;
  service: GenerationService<GenerationDraft>;
  source?: MapDescriptor;
  selection?: RegionSelection;
  /** Present when the selection opens a real-scale map (ADR 0016). */
  realScale?: RealScaleChoice;
  onGenerate(draft: GenerationDraft, prepared: PreparedSetup): void | Promise<void>;
  onManual?(draft: GenerationDraft): void | Promise<void>;
  onCancel?(): void;
}
export function generationAction(
  options: Pick<GenerationWorkflowOptions, "source" | "selection" | "realScale">,
  draft: GenerationDraft
): GenerationAction<GenerationDraft> {
  if (options.selection)
    return {
      method: "refine",
      request: {
        selection: options.selection,
        configuration: draft,
        ...(options.realScale ? { realScale: options.realScale } : {}),
      },
    };
  if (options.source)
    return {
      method: "regenerate",
      request: { reference: options.source.reference, configuration: draft },
    };
  return { method: "create", request: draft };
}
function useDraftReview({
  initial,
  service,
  source,
  selection,
  realScale,
}: GenerationWorkflowOptions) {
  const [draft, setDraft] = useState(initial);
  const [prepared, setPrepared] = useState<PreparedSetup | null>(null);
  const [previous, setPrevious] = useState<PreparedSetup | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [baseline, setBaseline] = useState<{
    draft: GenerationDraft;
    prepared: PreparedSetup | null;
  }>({ draft: initial, prepared: null });
  const revision = useRef(0);
  useEffect(() => {
    const current = ++revision.current;
    let active = true;
    void service.review(generationAction({ source, selection, realScale }, draft)).then(
      (value) => {
        if (!active || current !== revision.current) return;
        const review = value as PreparedSetup;
        setPrepared(review);
        setPrevious(review);
        setError(null);
        setBaseline((baseline) => (baseline.prepared ? baseline : { draft, prepared: review }));
      },
      (error: unknown) => {
        if (active && current === revision.current) setError(error);
      }
    );
    return () => {
      active = false;
    };
  }, [draft, service, source, selection, realScale]);
  const change = (next: GenerationDraft) => {
    revision.current++;
    setPrepared(null);
    setDraft(next);
  };
  const choose = async (control: string, choice: string) => {
    const current = ++revision.current;
    setPrepared(null);
    try {
      const next = await service.choose(draft, control, choice);
      if (revision.current === current) change(next);
    } catch (error) {
      if (revision.current === current) setError(error);
    }
  };
  const shown = prepared?.input.settings
    ? { ...draft, recipe: { ...draft.recipe, settings: prepared.input.settings } }
    : draft;
  return {
    draft: shown,
    prepared,
    setup: prepared?.setup ?? projectInvalidDraft(draft, previous?.setup ?? null),
    error,
    baseline,
    cartography: (prepared ?? previous)?.cartography ?? {},
    change,
    choose,
  };
}
export function useGenerationWorkflow(options: GenerationWorkflowOptions) {
  const review = useDraftReview(options);
  const [stage, setStage] = useState<WorkflowStage>("world");
  const [target, setTarget] = useState<string | null>(null);
  const [targetField, setTargetField] = useState<string | undefined>();
  const [targetRevision, setTargetRevision] = useState(0);
  const [tuning, setTuning] = useState<string | null>(null);
  const [epoch, setEpoch] = useState("");
  const [approach, setApproach] = useState<"procedural" | "blank">("procedural");
  const [json, setJson] = useState({ text: "", dirty: false });
  const feature = (id: string, patch: FeatureSelection[string]) =>
    review.change(updateFeature(review.draft, id, patch));
  const locate = (id: string, field?: string) => {
    const feature = review.setup?.features.find((entry) => entry.id === id);
    const epoch = field?.match(/^feature\..+\.epochs\.([^.]+)\./)?.[1];
    if (epoch) setEpoch(decodeURIComponent(epoch));
    const section = cartographicFeatureStage(id);
    setStage(options.source && section === "land" ? "environment" : section);
    setTuning(id);
    setTarget(id);
    setTargetField(field);
    setTargetRevision((value) => value + 1);
    return feature;
  };
  return {
    ...review,
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
    feature,
    locate,
    options,
  };
}
export type GenerationWorkflow = ReturnType<typeof useGenerationWorkflow>;
