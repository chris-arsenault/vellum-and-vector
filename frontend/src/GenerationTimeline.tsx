import { useContext, useState } from "react";
import type { Epoch } from "@atlas/domain";
import type { GenerationDraft } from "./generationDraft";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { WorkflowFieldsContext, useWorkflowFields } from "./workflowFieldState";
import { NumberField } from "./WorkflowFields";
import { WorkflowCommittedName } from "./WorkflowCommittedName";
import { HistoryPreset } from "./PhysicalHistoryForm";
import { ErrorMessage } from "./ErrorMessage";
import { epochFieldPrefix, selectedDraftEpoch } from "./generationEpochFields";
import { draftEpochBindings } from "./generationEpochBindings";
import {
  draftEpochs,
  renameDraftEpoch,
  insertDraftEpoch,
  deleteDraftEpoch,
  moveDraftEpoch,
  replaceDraftEpochs,
  updatePhysicalEpoch,
} from "./generationDraftEpochs";

export function GenerationClockInstructions() {
  return (
    <p className="hint">
      Use the shared history above to edit epoch names, order and durations. Each feature configures
      its response to that same history.
    </p>
  );
}

export function GenerationTimeline({ flow }: { flow: GenerationWorkflow }) {
  const epochs = draftEpochs(flow.draft),
    selected = selectedDraftEpoch(flow);
  const editable = Boolean(
    flow.setup?.features.find((feature) => feature.id === "physical.lifecycle")
      ?.configurationEditable
  );
  return (
    <section className="setup-timeline" aria-label="Shared epochs">
      <div className="setup-timeline-strip">
        <label>
          Selected epoch
          <select value={selected.id} onChange={(event) => flow.setEpoch(event.target.value)}>
            {epochs.map((epoch, index) => (
              <option key={epoch.id} value={epoch.id}>
                {index + 1}. {epoch.id}
              </option>
            ))}
          </select>
        </label>
        <span>
          {selected.duration} years · {epochs.length} shared epochs
        </span>
      </div>
      {editable ? (
        <details>
          <summary>Edit shared history</summary>
          <ClockEditor flow={flow} selected={selected} />
        </details>
      ) : (
        <p className="hint">
          {flow.setup?.context.inherited ||
          flow.options.source?.world.generations.some((run) => run.domains.includes("physical"))
            ? "Completed history is inherited. Its epoch definitions stay fixed."
            : "Enable the shared generation lifecycle to edit epoch definitions."}
        </p>
      )}
    </section>
  );
}

function useClockEditor(flow: GenerationWorkflow, selected: Epoch) {
  const [error, setError] = useState<unknown>(null);
  const fields = useContext(WorkflowFieldsContext),
    { clear } = useWorkflowFields();
  const epochs = draftEpochs(flow.draft),
    index = epochs.findIndex((epoch) => epoch.id === selected.id);
  const run = (operation: () => GenerationDraft, next?: string) => {
    try {
      flow.change(operation());
      if (next) flow.setEpoch(next);
      setError(null);
    } catch (error) {
      setError(error);
    }
  };
  const clearEpoch = (id: string) => {
    for (const binding of draftEpochBindings()) clear(epochFieldPrefix(binding.id, id));
  };
  const rename = (id: string) => {
    if (id === selected.id) return;
    if (!id) throw new Error("Enter an epoch name.");
    if (epochs.some((epoch) => epoch.id === id && epoch.id !== selected.id))
      throw new Error("An epoch already uses that name.");
    const next = renameDraftEpoch(flow.draft, selected.id, id);
    for (const { id: owner } of draftEpochBindings()) {
      const previous = epochFieldPrefix(owner, selected.id),
        target = epochFieldPrefix(owner, id);
      for (const [key, entry] of Object.entries(fields?.entries ?? {}))
        if (key.startsWith(previous) && !key.endsWith(".name"))
          fields!.edit(target + key.slice(previous.length), entry);
    }
    clearEpoch(selected.id);
    flow.change(next);
    flow.setEpoch(id);
    setError(null);
  };
  const remove = () =>
    run(
      () => {
        const next = deleteDraftEpoch(flow.draft, selected.id);
        clearEpoch(selected.id);
        return next;
      },
      epochs[index - 1]?.id ?? epochs[index + 1]?.id
    );
  const add = () => {
    let number = epochs.length + 1;
    while (epochs.some((epoch) => epoch.id === `Epoch ${number}`)) number++;
    const id = `Epoch ${number}`;
    run(() => insertDraftEpoch(flow.draft, index + 1, id), id);
  };
  const preset = (next: Epoch[]) =>
    run(() => {
      const result = replaceDraftEpochs(flow.draft, next);
      for (const epoch of epochs) clearEpoch(epoch.id);
      return result;
    }, next[0].id);
  const move = (index: number) => run(() => moveDraftEpoch(flow.draft, selected.id, index));
  return { error, rename, remove, add, preset, move, index, count: epochs.length };
}

function ClockEditor({ flow, selected }: { flow: GenerationWorkflow; selected: Epoch }) {
  const { error, rename, remove, add, preset, move, index, count } = useClockEditor(flow, selected);
  return (
    <>
      <HistoryPreset change={preset} />
      <div className="setup-setting-grid">
        <WorkflowCommittedName
          fieldKey={`${epochFieldPrefix("physical.lifecycle", selected.id)}name`}
          label="Epoch name"
          value={selected.id}
          commit={rename}
        />
        <NumberField
          fieldKey={`${epochFieldPrefix("physical.lifecycle", selected.id)}duration`}
          label="Epoch duration"
          unit="years"
          value={selected.duration!}
          min={Number.MIN_VALUE}
          change={(duration) =>
            flow.change(updatePhysicalEpoch(flow.draft, selected.id, { duration }))
          }
        />
      </div>
      <div className="setup-inline-actions">
        <button type="button" disabled={index === 0} onClick={() => move(index - 1)}>
          Move epoch earlier
        </button>
        <button type="button" disabled={index === count - 1} onClick={() => move(index + 1)}>
          Move epoch later
        </button>
        <button type="button" onClick={add}>
          Add epoch
        </button>
        <button type="button" disabled={count === 1} onClick={remove}>
          Remove epoch
        </button>
      </div>
      <small className="hint">
        Epoch durations are shared. Physical, ecological and magical controls use this same selected
        epoch.
      </small>
      <ErrorMessage error={error} />
    </>
  );
}
