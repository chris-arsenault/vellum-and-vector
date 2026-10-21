import { useEffect, useRef } from "react";
import type { SetupFeature } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { GenerationFeatureConfiguration } from "./GenerationFeatureConfiguration";
import { GenerationEpochConfiguration } from "./GenerationEpochConfiguration";
import { GenerationTimeline } from "./GenerationTimeline";
import { featureControlSettings } from "./generationWorkflowPresentation";
import { NumberField } from "./WorkflowFields";
import { setFeatureSetting } from "./generationDraft";
import { generationFeatureAdapter } from "./generationFeatureAdapters";
import { useWorkflowFields } from "./workflowFieldState";
import { discardFeatureFieldEdits } from "./generationFieldEdits";

/** One requested editor, not a hidden catalogue of every feature's form. */
export function GenerationTuning({ flow }: { flow: GenerationWorkflow }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const feature = flow.setup?.features.find((item) => item.id === flow.tuning);
  useEffect(() => {
    if (flow.tuning) heading.current?.focus();
  }, [flow.tuning]);
  if (!feature) return null;
  return (
    <section className="setup-tuning" aria-label="Advanced generation settings">
      <header>
        <h3 ref={heading} tabIndex={-1}>
          Adjust generation settings
        </h3>
        <button type="button" onClick={() => flow.setTuning(null)}>
          Close adjustments
        </button>
      </header>
      <label>
        Advanced capability
        <select
          aria-label="Advanced capability"
          value={feature.id}
          onChange={(event) => flow.locate(event.target.value)}
        >
          {flow
            .setup!.features.filter(
              (item) => item.id !== "magic.local" || flow.setup!.context.locatedSources > 0
            )
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
        </select>
      </label>
      <GenerationTimeline flow={flow} />
      <FeatureTuning flow={flow} feature={feature} />
    </section>
  );
}
/** A categorical setting is a choice; every other setting keeps its validated number field. */
function SettingControl({
  flow,
  setting: { key, owner, definition, value, active },
}: {
  flow: GenerationWorkflow;
  setting: ReturnType<typeof featureControlSettings>[number];
}) {
  const current = flow.draft.recipe.features?.[owner]?.settings?.[key] ?? value,
    change = (next: number) => flow.change(setFeatureSetting(flow.draft, owner, key, next));
  if (definition.choices)
    return (
      <label>
        {definition.label}
        <select
          value={current}
          disabled={!active}
          onChange={(event) => change(Number(event.target.value))}
        >
          {definition.choices.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <NumberField
      fieldKey={"feature." + owner + "." + key}
      label={definition.label}
      unit={definition.unit}
      value={current}
      min={definition.exclusiveMinimum ? Number.MIN_VALUE : definition.minimum}
      max={definition.maximum}
      step={definition.integer ? 1 : "any"}
      disabled={!active}
      change={change}
    />
  );
}
function FeatureTuning({ flow, feature }: { flow: GenerationWorkflow; feature: SetupFeature }) {
  const fields = useWorkflowFields();
  return (
    <div id={"setup-" + feature.id}>
      <label className="check">
        <input
          type="checkbox"
          checked={feature.enabled}
          disabled={feature.status === "inherited"}
          onChange={(event) => {
            if (!event.target.checked) discardFeatureFieldEdits(flow, feature.id, fields);
            flow.feature(feature.id, { enabled: event.target.checked });
          }}
        />
        {feature.label}
      </label>
      {feature.reason && <p className="hint">{feature.reason}</p>}
      <div className="setup-setting-grid">
        {featureControlSettings(flow, feature.id).map((setting) => (
          <SettingControl key={setting.owner + "." + setting.key} flow={flow} setting={setting} />
        ))}
      </div>
      <GenerationFeatureConfiguration flow={flow} feature={feature} />
      {generationFeatureAdapter(feature.id)?.Editor && (
        <GenerationEpochConfiguration flow={flow} feature={feature} />
      )}
    </div>
  );
}
