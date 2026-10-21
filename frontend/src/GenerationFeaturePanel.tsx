import type { ReactNode } from "react";
import type { SetupFeature } from "@atlas/generation";
import { setFeatureSetting } from "./generationDraft";
import { NumberField } from "./WorkflowFields";
import {
  diagnosticFeature,
  diagnosticField,
  diagnosticText,
  enablePrerequisites,
  featureLabel,
  featureControlSettings,
} from "./generationWorkflowPresentation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";

export function GenerationFeaturePanel({
  flow,
  feature,
  children,
}: {
  flow: GenerationWorkflow;
  feature: SetupFeature;
  children?: ReactNode;
}) {
  return (
    <article
      className="setup-feature"
      id={`setup-${feature.id}`}
      aria-labelledby={`title-${feature.id}`}
    >
      <header className="setup-feature-header">
        <label className="setup-feature-toggle" id={`title-${feature.id}`}>
          <input
            type="checkbox"
            checked={feature.enabled}
            disabled={feature.status === "inherited"}
            onChange={(event) => flow.feature(feature.id, { enabled: event.target.checked })}
          />
          {feature.label}
        </label>
        <span className={`setup-status status-${feature.status}`}>{statusLabel(feature)}</span>
      </header>
      {feature.reason && feature.status !== "off" && <p className="hint">{feature.reason}</p>}
      <FeatureSettings flow={flow} feature={feature} />
      {children}
      <FeatureProblems flow={flow} feature={feature} />
      <details className="setup-feature-details">
        <summary>Dependencies & outputs</summary>
        <p className="setup-feature-description">{feature.presentation.summary}</p>
        <FeatureRelationships flow={flow} feature={feature} />
      </details>
    </article>
  );
}
function statusLabel(feature: SetupFeature) {
  if (feature.status === "active") return "On";
  if (feature.status === "inherited") return "Inherited";
  if (feature.status === "unavailable") return "No active contribution";
  return "Off";
}
function FeatureSettings({ flow, feature }: { flow: GenerationWorkflow; feature: SetupFeature }) {
  const settings = featureControlSettings(flow, feature.id);
  if (!settings.length) return null;
  const reasons = [
    ...new Set(
      settings.flatMap((setting) =>
        setting.reason && setting.reason !== feature.reason ? [setting.reason] : []
      )
    ),
  ];
  return (
    <>
      <div className="setup-setting-grid">
        {settings.map(({ key, owner, definition, value, active }) => (
          <NumberField
            key={`${owner}.${key}`}
            fieldKey={`feature.${owner}.${key}`}
            label={definition.label}
            unit={definition.unit}
            value={flow.draft.recipe.features?.[owner]?.settings?.[key] ?? value}
            min={definition.exclusiveMinimum ? Number.MIN_VALUE : definition.minimum}
            max={definition.maximum}
            step={definition.integer ? 1 : "any"}
            disabled={!active}
            change={(next) => flow.change(setFeatureSetting(flow.draft, owner, key, next))}
          />
        ))}
      </div>
      {reasons.map((reason) => (
        <small className="hint" key={reason}>
          {reason}
        </small>
      ))}
    </>
  );
}
function FeatureRelationships({
  flow,
  feature,
}: {
  flow: GenerationWorkflow;
  feature: SetupFeature;
}) {
  const layers = [
    ...new Map(
      feature.publications
        .filter((item) => item.publish !== false)
        .map((item) => [item.layer.id, item.layer.name])
    ).values(),
  ];
  return (
    <>
      {feature.requires.length > 0 && (
        <p>
          Requires{" "}
          {feature.requires.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <button type="button" className="setup-link" onClick={() => flow.locate(id)}>
                {featureLabel(flow, id)}
              </button>
            </span>
          ))}
          .
        </p>
      )}
      {feature.requiredBy.length > 0 && (
        <p>
          Used by{" "}
          {feature.requiredBy.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <button type="button" className="setup-link" onClick={() => flow.locate(id)}>
                {featureLabel(flow, id)}
              </button>
            </span>
          ))}
          .
        </p>
      )}
      {layers.length > 0 && <p>Outputs: {layers.join(", ")}.</p>}
      <p className="hint">
        {feature.invocations.filter((item) => item.scheduled).length} scheduled operations.
        Execution details are available in Review.
      </p>
    </>
  );
}
function FeatureProblems({ flow, feature }: { flow: GenerationWorkflow; feature: SetupFeature }) {
  const errors = feature.diagnostics.filter((item) => item.severity === "error");
  if (!errors.length) return null;
  const missing = feature.requires.filter(
    (id) => !flow.setup?.features.find((entry) => entry.id === id)?.enabled
  );
  return (
    <div className="setup-feature-problems">
      {errors.map((item, index) => {
        const owner = diagnosticFeature(flow, item);
        return (
          <p key={index}>
            {diagnosticText(flow, item)}
            {owner && (owner.id !== feature.id || diagnosticField(flow, item)) && (
              <>
                {" "}
                <button
                  type="button"
                  className="setup-link"
                  onClick={() => flow.locate(owner.id, diagnosticField(flow, item))}
                >
                  Edit {owner.label}
                </button>
              </>
            )}
            {item.code === "feature_dependency" &&
              item.resource &&
              flow.setup?.features.some(
                (entry) => entry.id === item.resource && !entry.enabled
              ) && (
                <button
                  type="button"
                  onClick={() => flow.feature(item.resource!, { enabled: true })}
                >
                  Enable {featureLabel(flow, item.resource)}
                </button>
              )}
          </p>
        );
      })}
      {missing.length > 0 && (
        <button type="button" onClick={() => enablePrerequisites(flow, feature)}>
          Enable required features
        </button>
      )}
      {!feature.enabled &&
        feature.requiredBy.map((id) => (
          <button type="button" key={id} onClick={() => flow.feature(id, { enabled: false })}>
            Turn off {featureLabel(flow, id)}
          </button>
        ))}
    </div>
  );
}
