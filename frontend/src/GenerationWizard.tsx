import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { ErrorMessage } from "./ErrorMessage";
import { GenerationWorldStep } from "./GenerationWorldStep";
import { GenerationSetupSummary } from "./GenerationSetupSummary";
import { GenerationReview } from "./GenerationReview";
import { RegionGenerationContext } from "./RegionGenerationContext";
import { CartographicDecisions } from "./CartographicDecisions";
import { GenerationTuning } from "./GenerationTuning";
import { GenerationMagicStep } from "./GenerationMagicStep";
import { WorkflowFieldProvider } from "./WorkflowFields";
import { useWorkflowFields } from "./workflowFieldState";
import { workflowStages } from "./generationWorkflowPresentation";
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
function setupStages(flow: GenerationWorkflow) {
  return flow.options.source
    ? workflowStages.filter((stage) => stage.id !== "land")
    : workflowStages;
}
function SetupWorkspace({ options }: { options: GenerationWorkflowOptions }) {
  const flow = useGenerationWorkflow(options);
  const fields = useWorkflowFields();
  const generate = useSetupGeneration(flow, fields.errors);
  const stages = setupStages(flow);
  const index = stages.findIndex((stage) => stage.id === flow.stage);
  const final = flow.stage === "review" || flow.approach === "blank";
  return (
    <section className="generation-wizard setup-workspace" aria-label="Generation wizard">
      <form
        className="setup-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (final) generate.mutate();
          else {
            flow.setTuning(null);
            flow.setStage(stages[index + 1].id);
          }
        }}
      >
        <div className="setup-body">
          <StageRail flow={flow} />
          <SetupContent flow={flow} error={generate.error} />
          <GenerationSetupSummary flow={flow} />
        </div>
        <SetupActions
          flow={flow}
          pending={generate.isPending}
          blocked={final && invalid(flow, fields.errors)}
        />
      </form>
    </section>
  );
}
function useSetupGeneration(flow: GenerationWorkflow, errors: Record<string, string>) {
  return useMutation({
    mutationFn: async () => {
      if (!flow.draft.name.trim()) throw new Error("Name the mapped area before creating it.");
      if (Object.keys(errors).length) throw new Error("Correct or discard unfinished field edits.");
      if (flow.json.dirty) throw new Error("Apply or discard the JSON edits before generating.");
      if (flow.approach === "blank" && flow.options.onManual)
        return flow.options.onManual(flow.draft);
      if (!flow.prepared || flow.prepared.diagnostics.some((item) => item.severity === "error"))
        throw new Error("Resolve the generation dependencies before generating.");
      await flow.options.onGenerate(flow.draft, flow.prepared);
    },
  });
}
function StageRail({ flow }: { flow: GenerationWorkflow }) {
  return (
    <nav className="setup-rail" aria-label="Generation steps">
      <ol>
        {setupStages(flow).map((item, position) => (
          <li key={item.id}>
            <button
              type="button"
              aria-current={flow.stage === item.id ? "step" : undefined}
              disabled={flow.approach === "blank" && item.id !== "world"}
              onClick={() => {
                flow.setTuning(null);
                flow.setStage(item.id);
              }}
            >
              <span className="setup-stage-number">{position + 1}</span>
              {item.title}
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="setup-link"
        onClick={() => flow.locate("physical.lifecycle")}
      >
        History & advanced settings
      </button>
    </nav>
  );
}
function SetupContent({ flow, error }: { flow: GenerationWorkflow; error: unknown }) {
  const heading = useSetupFocus(flow);
  const stage = workflowStages.find((item) => item.id === flow.stage)!;
  return (
    <section className="setup-content" aria-labelledby="setup-stage-title">
      <header className="stage-heading">
        <h2 id="setup-stage-title" ref={heading} tabIndex={-1}>
          {stage.title}
        </h2>
        <p>{stage.question}</p>
      </header>
      {flow.options.source && flow.options.areaId && (
        <RegionGenerationContext world={flow.options.source.world} areaId={flow.options.areaId} />
      )}
      <StageContent flow={flow} />
      <GenerationTuning key={flow.targetRevision} flow={flow} />
      <ErrorMessage error={error} />
    </section>
  );
}
function StageContent({ flow }: { flow: GenerationWorkflow }) {
  if (flow.stage === "magic") return <GenerationMagicStep flow={flow} />;
  if (flow.stage === "world") return <GenerationWorldStep flow={flow} />;
  if (flow.stage === "review") return <GenerationReview flow={flow} />;
  return <CartographicDecisions flow={flow} />;
}
function useSetupFocus(flow: GenerationWorkflow) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [flow.stage]);
  useEffect(() => {
    if (!flow.target) return;
    const target = document.getElementById("setup-" + flow.target);
    const input = flow.targetField
      ? document.getElementsByName(flow.targetField)[0]
      : target?.querySelector("input");
    for (let parent = input?.parentElement; parent; parent = parent.parentElement)
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    (input ?? target)?.scrollIntoView({ block: "nearest" });
    (input as HTMLElement | null)?.focus();
  }, [flow.target, flow.targetField, flow.targetRevision, flow.stage]);
  return heading;
}
function SetupActions({
  flow,
  pending,
  blocked,
}: {
  flow: GenerationWorkflow;
  pending: boolean;
  blocked: boolean;
}) {
  const stages = setupStages(flow);
  const index = stages.findIndex((stage) => stage.id === flow.stage);
  const final = flow.stage === "review" || flow.approach === "blank";
  return (
    <footer className="setup-actions">
      <div>
        {flow.options.onCancel && (
          <button type="button" onClick={flow.options.onCancel}>
            Cancel setup
          </button>
        )}
      </div>
      <div>
        {index > 0 && (
          <button
            type="button"
            onClick={() => {
              flow.setTuning(null);
              flow.setStage(stages[index - 1].id);
            }}
          >
            Back
          </button>
        )}
        {flow.stage === "world" && flow.approach === "procedural" && (
          <button type="button" onClick={() => flow.setStage("review")}>
            Review defaults
          </button>
        )}
        <button className="primary" disabled={pending || blocked}>
          {pending ? "Starting…" : final ? finalAction(flow) : "Next"}
        </button>
      </div>
    </footer>
  );
}
function invalid(flow: GenerationWorkflow, errors: Record<string, string>) {
  if (!flow.draft.name.trim() || Object.keys(errors).length || flow.json.dirty) return true;
  return (
    flow.approach !== "blank" &&
    (!flow.prepared || flow.prepared.diagnostics.some((item) => item.severity === "error"))
  );
}
function finalAction(flow: GenerationWorkflow) {
  if (flow.approach === "blank") return "Create world";
  return flow.options.source ? "Generate region" : "Generate world";
}
