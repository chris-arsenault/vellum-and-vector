import type { SetupFeature } from "@atlas/generation";
import { beforePresentEpoch } from "@atlas/domain";
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
            Human eras advance population, cultural contact, works and political reach; the
            capabilities above decide which identities and territories they produce.{" "}
            {scheduleSummary(eras)}
          </small>
          {eras.map((era, index) => (
            <HumanEra key={index} flow={flow} era={era} index={index} removeIndex={removeIndex} />
          ))}
          <button type="button" onClick={() => flow.change(addHumanEra(flow.draft))}>
            Add era
          </button>
        </fieldset>
      )}
    </>
  );
}
/** How long the schedule runs: settled years in the present and years in rounds before it. */
function scheduleSummary(eras: OperativeEra[]) {
  const sum = (bound: boolean) =>
    Math.round(
      eras
        .filter((era) => Boolean(era.physicalEpoch) === bound)
        .reduce((total, era) => total + era.years, 0)
    );
  const settled = sum(false),
    rounds = sum(true);
  if (!eras.length) return "No eras: the present is settled without a human history.";
  return `${settled.toLocaleString()} years of settled history in the present${
    rounds ? ` after ${rounds.toLocaleString()} years of mobile rounds in earlier epochs` : ""
  }.`;
}
/** One era as a named group, so two eras' identical fields stay addressable. */
function HumanEra({
  flow,
  era,
  index,
  removeIndex,
}: {
  flow: GenerationWorkflow;
  era: OperativeEra;
  index: number;
  removeIndex: (prefix: string, index: number) => void;
}) {
  return (
    <fieldset className="setup-human-era" key={index}>
      <legend>{era.id}</legend>
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
          change={(mobility) => flow.change(updateHumanEra(flow.draft, index, { mobility }))}
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
    </fieldset>
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
          <option value={beforePresentEpoch}>
            Epoch before the present (now {draftEpochs(flow.draft).at(-2)?.id ?? "none"})
          </option>
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
