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
  type OperativeEra,
} from "./generationHumanEras";
import { draftEpochs } from "./generationDraftEpochs";

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
          <legend>Human eras</legend>
          <small className="hint">
            Human eras advance population, cultural contact, works and political reach. Domain
            selection controls which identities and territories are generated.
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
                <EraConditions flow={flow} era={era} index={index} />
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
    </>
  );
}
function EraConditions({
  flow,
  era,
  index,
}: {
  flow: GenerationWorkflow;
  era: OperativeEra;
  index: number;
}) {
  return (
    <>
      <NumberField
        label="Political capacity"
        unit="multiplier"
        fieldKey={`human.eras.${index}.politicalCapacity`}
        value={era.politicalCapacity ?? 1}
        min={0}
        change={(politicalCapacity) =>
          flow.change(updateHumanEra(flow.draft, index, { politicalCapacity }))
        }
      />
      <label>
        Physical regime
        <select
          aria-label="Physical regime"
          value={era.physicalEpoch ?? ""}
          onChange={(e) =>
            flow.change(
              updateHumanEra(flow.draft, index, { physicalEpoch: e.target.value || null })
            )
          }
        >
          <option value="">Present conditions</option>
          {draftEpochs(flow.draft).map((e) => (
            <option value={e.id} key={e.id}>
              {e.id}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
