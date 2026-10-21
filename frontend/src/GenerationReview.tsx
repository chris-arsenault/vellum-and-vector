import type { GenerationWorkflow } from "./useGenerationWorkflow";
import {
  cartographicValue,
  visibleCartographicControls,
  cartographicFieldPending,
} from "./cartographicDraft";
import { useWorkflowFields } from "./workflowFieldState";
import { GenerationConfigurationSummary } from "./GenerationConfigurationSummary";
import { GenerationRecipeEditor } from "./GenerationRecipeEditor";
import { SetupDisclosure } from "./SetupDisclosure";

export function GenerationReview({ flow }: { flow: GenerationWorkflow }) {
  const fields = useWorkflowFields();
  const controls = visibleCartographicControls(Boolean(flow.options.source));
  const changed =
    flow.setup?.features.filter(
      (feature) =>
        JSON.stringify(flow.draft.recipe.features?.[feature.id]) !==
        JSON.stringify(flow.baseline.draft.recipe.features?.[feature.id])
    ) ?? [];
  return (
    <>
      <p>
        <strong>{flow.draft.name || "Untitled world"}</strong> · {flow.draft.width / 1000} ×{" "}
        {flow.draft.height / 1000} km · {flow.draft.recipe.quality} detail · seed{" "}
        {flow.draft.recipe.seed}
      </p>
      <dl className="cartographic-review">
        {controls.map((control) => {
          const value = cartographicFieldPending(control, fields.errors)
            ? "custom"
            : cartographicValue(flow.draft, control);
          return (
            <div key={control.id}>
              <dt>{control.label}</dt>
              <dd>
                {control.choices.find((choice) => choice.id === value)?.label ?? "Custom"}
                <button
                  type="button"
                  className="setup-link"
                  onClick={() => {
                    flow.setTuning(null);
                    flow.setStage(control.section);
                  }}
                >
                  Change {control.label.toLowerCase()}
                </button>
              </dd>
            </div>
          );
        })}
      </dl>
      <ReviewContext flow={flow} />
      {changed.length > 0 && (
        <SetupDisclosure title="Advanced changes" className="setup-review-changes">
          <ul>
            {changed.map((feature) => (
              <li key={feature.id}>
                <button
                  type="button"
                  className="setup-link"
                  onClick={() => flow.locate(feature.id)}
                >
                  {feature.label}
                </button>
                {!feature.enabled && " · omitted"}
                {feature.settings
                  .filter(
                    (setting) => setting.active && setting.value !== setting.definition.default
                  )
                  .map((setting) => (
                    <span key={setting.key}>
                      {" "}
                      · {setting.definition.label} {setting.value} {setting.definition.unit}
                    </span>
                  ))}
                <GenerationConfigurationSummary flow={flow} feature={feature} />
              </li>
            ))}
          </ul>
        </SetupDisclosure>
      )}
      <GenerationRecipeEditor flow={flow} />
    </>
  );
}
function ReviewContext({ flow }: { flow: GenerationWorkflow }) {
  const settings = flow.prepared?.input.settings;
  return (
    <section className="setup-review-context">
      <h3>History and influences</h3>
      <p>
        {settings?.epochs
          .map((epoch) => epoch.id + " · " + epoch.duration?.toLocaleString() + " years")
          .join(" → ")}
      </p>
      <p>
        {flow.setup?.context.inherited
          ? "Completed parent history is inherited."
          : "The selected systems act within this shared history."}
      </p>
      <p>{influenceSummary(flow)}</p>
      <button type="button" className="setup-link" onClick={flow.showInfluences}>
        Change influences
      </button>
    </section>
  );
}
function influenceSummary(flow: GenerationWorkflow) {
  if (
    !flow.draft.recipe.features?.["magic.configured"]?.enabled ||
    !flow.draft.recipe.domains.includes("magic")
  )
    return "Magical influences omitted";
  const systems = flow.prepared?.input.settings?.magicSystems.filter((system) => system.enabled);
  return (
    systems?.map((system) => system.name + " " + system.strength + "×").join(" · ") ||
    "No active sources; configured independent interaction rules remain included"
  );
}
