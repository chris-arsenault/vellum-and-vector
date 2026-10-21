import { useSyncExternalStore } from "react";
import { ErrorMessage } from "./ErrorMessage";
import {
  diagnosticFeature,
  diagnosticField,
  diagnosticText,
  locateWorkflowField,
} from "./generationWorkflowPresentation";
import { useWorkflowFields } from "./workflowFieldState";
import type { GenerationWorkflow } from "./useGenerationWorkflow";

export function GenerationSetupSummary({ flow }: { flow: GenerationWorkflow }) {
  const wide = useSyncExternalStore(subscribeWidth, wideSnapshot);
  const layers = [
    ...new Map(flow.setup?.publications.map((item) => [item.layer.id, item.layer.name])).values(),
  ];
  return (
    <aside className="setup-summary" aria-label="Setup summary">
      <details key={String(wide)} open={wide} className="setup-summary-disclosure">
        <summary>Setup summary</summary>
        <h3>{flow.draft.name || "Untitled world"}</h3>
        <dl>
          <div>
            <dt>Extent</dt>
            <dd>
              {flow.draft.width / 1000} × {flow.draft.height / 1000} km
            </dd>
          </div>
          <div>
            <dt>Detail</dt>
            <dd>{flow.draft.recipe.quality}</dd>
          </div>
          <div>
            <dt>Seed</dt>
            <dd>{flow.draft.recipe.seed}</dd>
          </div>
          <div>
            <dt>Context</dt>
            <dd>{flow.setup?.context.inherited ? "Inherited geography" : "Initial generation"}</dd>
          </div>
        </dl>
        <h4>Planned output layers</h4>
        {flow.approach === "blank" ? (
          <p>Empty atlas for manual authoring.</p>
        ) : (
          <ul>
            {layers.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )}
        {flow.approach === "procedural" && (
          <button type="button" className="setup-link" onClick={() => flow.setStage("review")}>
            Review all choices
          </button>
        )}
      </details>
      <SetupIssues flow={flow} />
    </aside>
  );
}
function wideSnapshot() {
  return window.matchMedia("(min-width: 1101px)").matches;
}
function subscribeWidth(changed: () => void) {
  const media = window.matchMedia("(min-width: 1101px)");
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
}
export function SetupIssues({ flow }: { flow: GenerationWorkflow }) {
  const fields = useWorkflowFields();
  const diagnostics = flow.approach === "blank" ? [] : (flow.prepared?.diagnostics ?? []);
  const preparationError = flow.approach === "procedural" ? flow.error : null;
  const unnamed = !flow.draft.name.trim();
  const issues = [
    diagnostics.length,
    Object.keys(fields.errors).length,
    preparationError,
    flow.json.dirty,
    unnamed,
  ];
  const blocking = [
    unnamed,
    flow.json.dirty,
    preparationError,
    Object.keys(fields.errors).length,
    diagnostics.some((item) => item.severity === "error"),
  ].some(Boolean);
  if (!issues.some(Boolean))
    return (
      <p className="setup-valid" role="status">
        Configuration ready to review.
      </p>
    );
  return (
    <section className="setup-issues" aria-label="Configuration issues">
      <h3>{blocking ? "Needs attention" : "Warnings"}</h3>
      {flow.json.dirty && (
        <p>
          Unapplied JSON edits.{" "}
          <button type="button" className="setup-link" onClick={() => flow.setStage("review")}>
            Apply or discard in Review
          </button>
          .
        </p>
      )}
      {unnamed && (
        <p>
          Name the mapped area in{" "}
          <button type="button" className="setup-link" onClick={() => flow.setStage("world")}>
            World
          </button>{" "}
          before creating it.
        </p>
      )}
      {Boolean(preparationError) && (
        <div role="alert">
          <p>Resolve the invalid configuration before generating.</p>
          <ErrorMessage error={preparationError} />
        </div>
      )}
      <UnfinishedFields flow={flow} />
      {diagnostics.map((item, i) => {
        const owner = diagnosticFeature(flow, item);
        return (
          <div key={i} role={item.severity === "error" ? "alert" : "status"}>
            <p>{diagnosticText(flow, item)}</p>
            {owner && (
              <button
                type="button"
                className="setup-link"
                onClick={() => flow.locate(owner.id, diagnosticField(flow, item))}
              >
                Edit {owner.label}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
function UnfinishedFields({ flow }: { flow: GenerationWorkflow }) {
  const fields = useWorkflowFields();
  return (
    <>
      {Object.entries(fields.errors).map(([key, message]) => (
        <p className="error" role="alert" key={key}>
          {message}{" "}
          <button
            type="button"
            className="setup-link"
            onClick={() => locateWorkflowField(flow, key)}
          >
            Edit field
          </button>
        </p>
      ))}
      {Object.keys(fields.errors).length > 0 && (
        <button type="button" onClick={() => fields.clear()}>
          Discard unfinished field edits
        </button>
      )}
    </>
  );
}
