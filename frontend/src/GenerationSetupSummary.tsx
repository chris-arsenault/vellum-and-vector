import { ErrorMessage } from "./ErrorMessage";
import type { Diagnostic } from "@atlas/domain";
import {
  diagnosticFeature,
  diagnosticField,
  diagnosticText,
  locateWorkflowField,
} from "./generationWorkflowPresentation";
import { useWorkflowFields } from "./workflowFieldState";
import type { GenerationWorkflow } from "./useGenerationWorkflow";

export function GenerationSetupSummary({ flow }: { flow: GenerationWorkflow }) {
  return (
    <aside className="setup-summary" aria-label="Setup summary">
      <h3>{flow.draft.name || "New world"}</h3>
      <p>
        {flow.draft.width / 1000} × {flow.draft.height / 1000} km
      </p>
      <p>
        {flow.draft.recipe.quality} detail · seed {flow.draft.recipe.seed}
      </p>
      {flow.setup?.context.inherited && (
        <p>Parent geography and completed history are inherited.</p>
      )}
      <SetupIssues flow={flow} />
    </aside>
  );
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
      {diagnostics.map((item, i) => (
        <SetupDiagnostic key={i} flow={flow} item={item} />
      ))}
    </section>
  );
}
function SetupDiagnostic({ flow, item }: { flow: GenerationWorkflow; item: Diagnostic }) {
  const owner = diagnosticFeature(flow, item);
  const missing = flow.setup?.features.find(
    (feature) => feature.id === item.resource && !feature.enabled
  );
  return (
    <div role={item.severity === "error" ? "alert" : "status"}>
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
      {missing && (
        <button
          type="button"
          className="setup-link"
          onClick={() => flow.feature(missing.id, { enabled: true })}
        >
          Enable {missing.label}
        </button>
      )}
    </div>
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
