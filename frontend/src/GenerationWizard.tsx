import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { ErrorMessage } from "./ErrorMessage";
import { GenerationFeaturePanel } from "./GenerationFeaturePanel";
import { GenerationWorldStep } from "./GenerationWorldStep";
import { GenerationSetupSummary } from "./GenerationSetupSummary";
import { GenerationReview } from "./GenerationReview";
import { RegionGenerationContext } from "./RegionGenerationContext";
import { GenerationTimeline } from "./GenerationTimeline";
import { GenerationFeatureConfiguration } from "./GenerationFeatureConfiguration";
import { WorkflowFieldProvider } from "./WorkflowFields";
import { useWorkflowFields } from "./workflowFieldState";
import { workflowStages, stageStatus } from "./generationWorkflowPresentation";
import {
  useGenerationWorkflow,
  type GenerationWorkflow,
  type GenerationWorkflowOptions,
} from "./useGenerationWorkflow";
import "./generationWizard.css";

export function GenerationWizard(options: GenerationWorkflowOptions) {
  return (
    <WorkflowFieldProvider>
      <SetupWorkspace options={options} />
    </WorkflowFieldProvider>
  );
}
function SetupWorkspace({ options }: { options: GenerationWorkflowOptions }) {
  const flow = useGenerationWorkflow(options),
    fields = useWorkflowFields();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [flow.stage]);
  useEffect(() => {
    if (!flow.target) return;
    const target = document.getElementById(`setup-${flow.target}`);
    const input = flow.targetField
      ? document.getElementsByName(flow.targetField)[0]
      : target?.querySelector<HTMLInputElement>("input");
    for (let parent = input?.parentElement; parent; parent = parent.parentElement)
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    (input ?? target)?.scrollIntoView({ block: "nearest" });
    (input as HTMLElement | null)?.focus();
  }, [flow.target, flow.targetField, flow.targetRevision, flow.stage]);
  const generate = useMutation({
    mutationFn: async () => {
      if (!flow.draft.name.trim()) throw new Error("Name the mapped area before creating it.");
      if (Object.keys(fields.errors).length)
        throw new Error("Correct or discard unfinished field edits.");
      if (flow.json.dirty) throw new Error("Apply or discard the JSON edits before generating.");
      if (flow.approach === "blank" && options.onManual) return options.onManual(flow.draft);
      if (!flow.prepared || flow.prepared.diagnostics.some((item) => item.severity === "error"))
        throw new Error("Resolve the generation dependencies before generating.");
      await options.onGenerate(flow.draft, flow.prepared);
    },
  });
  const stage = workflowStages.find((item) => item.id === flow.stage)!;
  return (
    <section className="generation-wizard setup-workspace" aria-label="Generation wizard">
      <form
        className="setup-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (flow.stage === "review" || flow.approach === "blank") generate.mutate();
          else
            flow.setStage(
              workflowStages[workflowStages.findIndex((item) => item.id === flow.stage) + 1].id
            );
        }}
      >
        <div className="setup-body">
          <StageRail flow={flow} />
          <section className="setup-content" aria-labelledby="setup-stage-title">
            <header className="stage-heading">
              <h2 id="setup-stage-title" ref={heading} tabIndex={-1}>
                {stage.title}
              </h2>
              <p>{stage.question}</p>
            </header>
            {options.source && options.areaId && (
              <RegionGenerationContext world={options.source.world} areaId={options.areaId} />
            )}
            {flow.stage !== "review" && flow.approach === "procedural" && (
              <GenerationTimeline flow={flow} />
            )}
            {flow.stage === "world" ? (
              <GenerationWorldStep flow={flow}>
                {flow.approach === "procedural" && <CapabilityStage flow={flow} />}
              </GenerationWorldStep>
            ) : (
              <StageContent flow={flow} />
            )}
            <ErrorMessage error={generate.error} />
          </section>
          <GenerationSetupSummary flow={flow} />
        </div>
        <SetupActions flow={flow} pending={generate.isPending} />
      </form>
    </section>
  );
}
function StageRail({ flow }: { flow: GenerationWorkflow }) {
  const { errors } = useWorkflowFields();
  return (
    <nav className="setup-rail" aria-label="Generation steps">
      <p className="eyebrow">{flow.options.source ? "Refine mapped area" : "New atlas"}</p>
      <ol>
        {workflowStages.map((stage, index) => (
          <li key={stage.id}>
            <button
              type="button"
              aria-current={flow.stage === stage.id ? "step" : undefined}
              disabled={flow.approach === "blank" && stage.id !== "world"}
              onClick={() => flow.setStage(stage.id)}
            >
              <span className="setup-stage-number">{String(index + 1).padStart(2, "0")}</span>
              <span>
                {stage.title}
                <small>{stageStatus(flow, stage.id, errors)}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="hint">Start from defaults. Open any stage to adjust its geography.</p>
    </nav>
  );
}
function StageContent({ flow }: { flow: GenerationWorkflow }) {
  if (flow.stage === "review") return <GenerationReview flow={flow} />;
  return <CapabilityStage flow={flow} />;
}
function CapabilityStage({ flow }: { flow: GenerationWorkflow }) {
  const features =
    flow.setup?.features.filter((feature) => feature.presentation.stage === flow.stage) ?? [];
  const families = [...new Set(features.map((feature) => feature.presentation.family))];
  return (
    <>
      {families.map((family) => (
        <section className="setup-family" key={family} aria-label={family}>
          <h3>{family}</h3>
          {features
            .filter((feature) => feature.presentation.family === family)
            .map((feature) => (
              <GenerationFeaturePanel key={feature.id} flow={flow} feature={feature}>
                <GenerationFeatureConfiguration flow={flow} feature={feature} />
              </GenerationFeaturePanel>
            ))}
        </section>
      ))}
    </>
  );
}
function SetupActions({ flow, pending }: { flow: GenerationWorkflow; pending: boolean }) {
  const { errors } = useWorkflowFields(),
    index = workflowStages.findIndex((item) => item.id === flow.stage);
  const final = flow.stage === "review" || flow.approach === "blank";
  const invalid = blockingIssues(flow, errors);
  const label = finalActionLabel(flow);
  return (
    <footer className="setup-actions">
      <SetupExitActions flow={flow} />
      <div>
        {index > 0 && (
          <button type="button" onClick={() => flow.setStage(workflowStages[index - 1].id)}>
            Back
          </button>
        )}
        {flow.stage === "world" && flow.approach === "procedural" && (
          <button type="button" onClick={() => flow.setStage("review")}>
            Use defaults & review
          </button>
        )}
        <button className="primary" disabled={pending || (final && invalid)}>
          {pending ? "Starting…" : final ? label : "Next"}
        </button>
      </div>
    </footer>
  );
}
function blockingIssues(flow: GenerationWorkflow, errors: Record<string, string>) {
  if (!flow.draft.name.trim() || Object.keys(errors).length > 0 || flow.json.dirty) return true;
  if (flow.approach === "blank") return false;
  return !flow.prepared || flow.prepared.diagnostics.some((item) => item.severity === "error");
}
function finalActionLabel(flow: GenerationWorkflow) {
  if (flow.approach === "blank") return "Create world";
  return flow.options.source ? "Generate region" : "Generate world";
}
function SetupExitActions({ flow }: { flow: GenerationWorkflow }) {
  return (
    <div>
      {flow.options.onCancel && (
        <button type="button" onClick={flow.options.onCancel}>
          Cancel setup
        </button>
      )}
      {!flow.options.source && <small>This session stays in this tab.</small>}
    </div>
  );
}
