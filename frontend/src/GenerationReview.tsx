import type { SetupFeature } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { workflowStages, featureControlSettings } from "./generationWorkflowPresentation";
import { GenerationConfigurationSummary } from "./GenerationConfigurationSummary";
import { GenerationRecipeEditor } from "./GenerationRecipeEditor";
import { GenerationExecutionInspector } from "./GenerationExecutionInspector";

export function GenerationReview({ flow }: { flow: GenerationWorkflow }) {
  return (
    <>
      <p>
        <strong>{flow.draft.name || "Untitled world"}</strong> · {flow.draft.width / 1000} ×{" "}
        {flow.draft.height / 1000} km · {flow.draft.recipe.quality} detail · seed{" "}
        {flow.draft.recipe.seed}
      </p>
      {!flow.prepared && (
        <p role="alert">Repair the configuration before reviewing its outcomes.</p>
      )}
      {flow.prepared && (
        <>
          <div className="setup-review-grid">
            {workflowStages
              .filter((stage) => stage.id !== "review")
              .map((stage) => (
                <ReviewFamily key={stage.id} flow={flow} stage={stage} />
              ))}
          </div>
          <ReviewHistory flow={flow} />
        </>
      )}
      <GenerationExecutionInspector flow={flow} />
      <GenerationRecipeEditor flow={flow} />
    </>
  );
}
function ReviewHistory({ flow }: { flow: GenerationWorkflow }) {
  const settings = flow.prepared?.input.settings;
  const layers = [...new Set(flow.setup?.publications.map((item) => item.layer.name))];
  return (
    <section aria-label="History and outputs">
      <h3>History and outputs</h3>
      <p>
        {settings?.epochs.length ?? 0} shared physical epochs
        {flow.setup?.context.inherited ? " · completed history is inherited" : ""}. Model passes do
        not add elapsed time. Present ecological classification adds no age.
      </p>
      <ul>
        {settings?.epochs.map((epoch) => (
          <li key={epoch.id}>
            {epoch.id} · {(epoch.duration ?? 1000).toLocaleString()} years
          </li>
        ))}
      </ul>
      <p>Output layers: {layers.join(", ") || "None selected"}.</p>
      <p className="hint">
        These choices control generated geography. Layer visibility is adjusted in the map editor.
      </p>
    </section>
  );
}
function ReviewFamily({
  flow,
  stage,
}: {
  flow: GenerationWorkflow;
  stage: (typeof workflowStages)[number];
}) {
  const features =
    flow.setup?.features.filter((feature) => feature.presentation.stage === stage.id) ?? [];
  const selected = features.filter((feature) => feature.enabled);
  const off = features.filter((feature) => !feature.enabled);
  return (
    <section aria-label={`${stage.title} choices`}>
      <h3>{stage.title}</h3>
      <ul className="setup-review-choices">
        {selected.map((feature) => (
          <ReviewFeature key={feature.id} flow={flow} feature={feature} />
        ))}
      </ul>
      {off.length > 0 && (
        <details>
          <summary>Omitted geography · {off.length}</summary>
          <ul>
            {off.map((feature) => (
              <li key={feature.id}>
                <EditFeature flow={flow} feature={feature} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
function ReviewFeature({ flow, feature }: { flow: GenerationWorkflow; feature: SetupFeature }) {
  const active = featureControlSettings(flow, feature.id).filter((setting) => setting.active);
  return (
    <li>
      <EditFeature flow={flow} feature={feature} />
      {feature.status !== "active" && (
        <small> · {feature.status === "inherited" ? "Inherited" : "No active contribution"}</small>
      )}
      {active.length > 0 && (
        <dl>
          {active.map((setting) => (
            <div key={setting.key}>
              <dt>{setting.definition.label}</dt>
              <dd>
                {setting.value} {setting.definition.unit}
                {setting.value !== setting.definition.default && " · changed from default"}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <GenerationConfigurationSummary flow={flow} feature={feature} />
      {feature.reason && <p className="hint">{feature.reason}</p>}
    </li>
  );
}
function EditFeature({ flow, feature }: { flow: GenerationWorkflow; feature: SetupFeature }) {
  return (
    <button type="button" className="setup-link" onClick={() => flow.locate(feature.id)}>
      {feature.label}
    </button>
  );
}
