import { defaultEcologyEpoch, type EcologyEpoch } from "@atlas/domain";
import type { SetupFeature } from "@atlas/generation";
import { NumberField } from "./WorkflowFields";
import {
  epochFieldPrefix,
  selectedDraftEpoch,
  physicalEpochControls,
  epochControlValue,
  changeEpochControl,
} from "./generationEpochFields";
import { updateEcologyEpoch } from "./generationDraftEpochs";
import type { GenerationWorkflow } from "./useGenerationWorkflow";

export function GenerationEpochConfiguration({
  flow,
  feature,
}: {
  flow: GenerationWorkflow;
  feature: SetupFeature;
}) {
  const controls = physicalEpochControls(feature.id),
    epoch = selectedDraftEpoch(flow);
  if (!controls.length) return null;
  const clock = flow.setup?.features.find((entry) => entry.id === "physical.lifecycle");
  if (!clock?.configurationEditable && flow.setup?.context.inherited)
    return (
      <div className="setup-configuration-summary">
        <h4>{epoch.id} · inherited controls</h4>
        <dl>
          {controls.map((control) => (
            <div key={control.key}>
              <dt>{control.label}</dt>
              <dd>
                {epochControlValue(epoch, control)} {control.unit}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  return (
    <fieldset
      className="setup-epoch-controls"
      disabled={!feature.enabled || !clock?.configurationEditable}
    >
      <legend>{epoch.id} · epoch controls</legend>
      <div className="setup-setting-grid">
        {controls.map((control) => (
          <NumberField
            key={control.key}
            fieldKey={`${epochFieldPrefix(control.key === "rainfall" ? "ecology.living" : "physical.lifecycle", epoch.id)}${control.key}`}
            label={control.label}
            unit={control.unit}
            value={epochControlValue(epoch, control)}
            min={control.min}
            max={control.max}
            change={(value) =>
              flow.change(changeEpochControl(flow.draft, epoch.id, control.key, value))
            }
          />
        ))}
      </div>
      <small className="hint">
        {feature.id === "physical.climate"
          ? "Temperature shift adds to the profile value. Epoch rainfall scales physical precipitation even when living ecology is off."
          : "These values edit the shared epoch. Profile controls above remain separate."}
      </small>
    </fieldset>
  );
}

const ecologyFields: { key: keyof EcologyEpoch; label: string; max: number }[] = [
  { key: "seasonality", label: "Seasonal climate contrast", max: 1 },
  { key: "productivity", label: "Epoch productivity", max: 5 },
  { key: "fire", label: "Wildfire regime", max: 5 },
  { key: "migration", label: "Migration and dispersal", max: 5 },
  { key: "recovery", label: "Soil recovery", max: 5 },
];
export function GenerationEcologyConfiguration({
  flow,
  feature,
}: {
  flow: GenerationWorkflow;
  feature: SetupFeature;
}) {
  const epoch = selectedDraftEpoch(flow),
    regime = { ...defaultEcologyEpoch, ...epoch.ecology };
  if (flow.setup?.context.inherited)
    return (
      <p className="hint">
        Inherited communities retain their biological age. Present classification and environmental
        response add no growth years; {epoch.id} supplies the inherited regime.
      </p>
    );
  return (
    <fieldset className="setup-epoch-controls" disabled={!feature.configurationEditable}>
      <legend>{epoch.id} · ecological regime</legend>
      <div className="setup-setting-grid setup-regime-grid">
        {ecologyFields.map(({ key, label, max }) => (
          <NumberField
            key={key}
            fieldKey={`${epochFieldPrefix("ecology.living", epoch.id)}${key}`}
            label={label}
            unit={key === "seasonality" ? "0–1" : "multiplier"}
            value={regime[key]}
            min={0}
            max={max}
            change={(value) =>
              flow.change(updateEcologyEpoch(flow.draft, epoch.id, { [key]: value }))
            }
          />
        ))}
      </div>
      <small className="hint">
        Epoch rainfall is controlled with climate. Productivity multiplies the profile control;
        present classification adds no biological age.
      </small>
    </fieldset>
  );
}
