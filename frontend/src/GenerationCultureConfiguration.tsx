import type { SetupFeature } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { NumberField } from "./WorkflowFields";
import { WorkflowCommittedName } from "./WorkflowCommittedName";
import { useWorkflowFields } from "./workflowFieldState";
import {
  addHumanEra,
  draftHumanEras,
  removeHumanEra,
  renameHumanEra,
  updateHumanEra,
} from "./generationHumanEras";

export function GenerationCultureConfiguration({
  flow,
  feature,
}: {
  flow: GenerationWorkflow;
  feature: SetupFeature;
}) {
  const eras = draftHumanEras(flow.draft),
    { removeIndex } = useWorkflowFields();
  const inherited = flow.setup?.context.inherited;
  return (
    <>
      {inherited ? (
        <p className="hint">
          Inherited cultural eras:{" "}
          {eras
            .map((era) => `${era.id} · ${era.years} years · mobility ${era.mobility}×`)
            .join("; ") || "none"}
          .
        </p>
      ) : (
        <fieldset disabled={!feature.configurationEditable}>
          <legend>Cultural spread</legend>
          <small className="hint">
            Years and mobility govern cultural spread through suitable geography. Political
            territory remains a separate choice.
          </small>
          {eras.map((era, index) => (
            <div className="setup-human-era" key={index}>
              <div className="setup-setting-grid">
                <WorkflowCommittedName
                  label="Era name"
                  fieldKey={`human.eras.${index}.name`}
                  value={era.id}
                  commit={(name) => flow.change(renameHumanEra(flow.draft, index, name))}
                />
                <NumberField
                  label="Cultural duration"
                  unit="years"
                  fieldKey={`human.eras.${index}.years`}
                  value={era.years}
                  min={Number.MIN_VALUE}
                  change={(years) => flow.change(updateHumanEra(flow.draft, index, { years }))}
                />
                <NumberField
                  label="Cultural mobility"
                  unit="multiplier"
                  fieldKey={`human.eras.${index}.mobility`}
                  value={era.mobility}
                  min={0}
                  change={(mobility) =>
                    flow.change(updateHumanEra(flow.draft, index, { mobility }))
                  }
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  removeIndex("human.eras", index);
                  flow.change(removeHumanEra(flow.draft, index));
                }}
              >
                Remove era
              </button>
            </div>
          ))}
          <button type="button" onClick={() => flow.change(addHumanEra(flow.draft))}>
            Add era
          </button>
        </fieldset>
      )}
      <LegacyMetadata flow={flow} />
    </>
  );
}
function LegacyMetadata({ flow }: { flow: GenerationWorkflow }) {
  const eras = flow.draft.recipe.settings.humanEras;
  const retained = eras.filter((era) => era.physicalEpoch !== null || era.politicalCapacity !== 1);
  if (!retained.length) return null;
  return (
    <details className="setup-legacy-metadata">
      <summary>Imported history metadata</summary>
      <p className="hint">
        Physical epoch references and political capacity are retained for compatibility. They do not
        control cultural or political generation.
      </p>
      <ul>
        {retained.map((era) => (
          <li key={era.id}>
            {era.id}: physical epoch {era.physicalEpoch ?? "none"}; political capacity{" "}
            {era.politicalCapacity}.
          </li>
        ))}
      </ul>
    </details>
  );
}
