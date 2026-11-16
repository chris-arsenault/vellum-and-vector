import { useEffect, useRef } from "react";
import { ErrorMessage } from "./ErrorMessage";
import { NumberField, WorkflowFieldProvider } from "./WorkflowFields";
import { useWorkflowFields } from "./workflowFieldState";
import {
  useGenerationWorkflow,
  type GenerationWorkflow,
  type GenerationWorkflowOptions,
} from "./useGenerationWorkflow";
import { invalidSetup, useSetupGeneration } from "./useSetupGeneration";
import { GenerationResolution } from "./GenerationResolution";
import { GenerationFeatureConfiguration } from "./GenerationFeatureConfiguration";
import { SettingControl } from "./GenerationTuning";
import { featureControlSettings } from "./generationWorkflowPresentation";
import { discardFeatureFieldEdits } from "./generationFieldEdits";
import type { SetupFeature, GenerationRecipe } from "./generationTypes";
import "./generationWizard.css";

export function RegionalGeneration(options: GenerationWorkflowOptions) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="refinement-dialog"
      aria-label="Refine region"
      onCancel={options.onCancel}
    >
      <WorkflowFieldProvider>
        <RegionalForm options={options} />
      </WorkflowFieldProvider>
    </dialog>
  );
}
// owner-direction(2026-11-15): regional refinement is a modal with only changeable selections
function RegionalForm({ options }: { options: GenerationWorkflowOptions }) {
  const flow = useGenerationWorkflow(options);
  const fields = useWorkflowFields();
  const generate = useSetupGeneration(flow, fields.errors);
  return (
    <form
      className="setup-workspace"
      onSubmit={(event) => {
        event.preventDefault();
        generate.mutate();
      }}
    >
      <header className="saved-maps-heading">
        <h2>Refine region</h2>
        <button type="button" onClick={options.onCancel} aria-label="Close refinement">
          ×
        </button>
      </header>
      <p>
        {flow.draft.width / 1000} × {flow.draft.height / 1000} km. Generating refines{" "}
        {options.source?.name}, an independent map; its parent stays unchanged.
      </p>
      <RegionalBrief flow={flow} />
      <details>
        <summary>Generation settings</summary>
        {flow.setup?.features.map((feature) => (
          <RegionalFeature key={feature.id} flow={flow} feature={feature} />
        ))}
      </details>
      <RegionalIssues flow={flow} />
      <ErrorMessage error={generate.error ?? flow.error} />
      <footer className="setup-actions">
        <button type="button" onClick={options.onCancel}>
          Cancel refinement
        </button>
        <button
          className="primary"
          disabled={generate.isPending || invalidSetup(flow, fields.errors)}
        >
          {generate.isPending ? "Starting…" : "Generate region"}
        </button>
      </footer>
    </form>
  );
}
function RegionalBrief({ flow }: { flow: GenerationWorkflow }) {
  const { draft, change } = flow;
  return (
    <div className="setup-world-grid">
      <label>
        Region name
        <input
          required
          value={draft.name}
          onChange={(e) => change({ ...draft, name: e.target.value })}
        />
      </label>
      <GenerationResolution
        resolutions={flow.prepared?.resolutions}
        quality={draft.recipe.quality}
        change={(quality) =>
          change({
            ...draft,
            recipe: { ...draft.recipe, quality: quality as GenerationRecipe["quality"] },
          })
        }
      />
      <NumberField
        label="Generation seed"
        fieldKey="world.seed"
        value={draft.recipe.seed}
        step={1}
        change={(seed) => change({ ...draft, recipe: { ...draft.recipe, seed } })}
      />
    </div>
  );
}
function RegionalFeature({ flow, feature }: { flow: GenerationWorkflow; feature: SetupFeature }) {
  const fields = useWorkflowFields();
  const settings = featureControlSettings(flow, feature.id).filter((setting) => setting.active);
  const selectable = feature.status === "active" || feature.status === "off";
  if (!selectable && !settings.length && !feature.configurationEditable) return null;
  return (
    <details>
      <summary>{feature.label}</summary>
      {selectable && (
        <label className="check">
          <input
            type="checkbox"
            checked={feature.enabled}
            onChange={(event) => {
              if (!event.target.checked) discardFeatureFieldEdits(flow, feature.id, fields);
              flow.feature(feature.id, { enabled: event.target.checked });
            }}
          />
          Include {feature.label}
        </label>
      )}
      <div className="setup-setting-grid">
        {settings.map((setting) => (
          <SettingControl key={setting.owner + "." + setting.key} flow={flow} setting={setting} />
        ))}
      </div>
      {feature.configurationEditable && (
        <GenerationFeatureConfiguration flow={flow} feature={feature} />
      )}
    </details>
  );
}
function RegionalIssues({ flow }: { flow: GenerationWorkflow }) {
  const fields = useWorkflowFields();
  return (
    <div aria-label="Refinement validation">
      {!flow.prepared && <p role="status">Reviewing regional settings…</p>}
      {flow.prepared?.diagnostics.map((item, index) => (
        <p key={index} role={item.severity === "error" ? "alert" : "status"}>
          {item.message}
        </p>
      ))}
      {Object.entries(fields.errors).map(([key, message]) => (
        <p key={key} role="alert">
          {message}
        </p>
      ))}
      {!!Object.keys(fields.errors).length && (
        <button type="button" onClick={() => fields.clear()}>
          Discard unfinished field edits
        </button>
      )}
    </div>
  );
}
