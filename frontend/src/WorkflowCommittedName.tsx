import { useContext, useId, useState, type KeyboardEvent } from "react";
import { WorkflowFieldsContext, type WorkflowFieldEntry } from "./workflowFieldState";

/** Identity changes commit explicitly so partial names never rekey bound settings. */
interface NameProps {
  fieldKey: string;
  label: string;
  value: string;
  commit(value: string): void;
}
function useCommittedName({ fieldKey, label, value, commit }: NameProps) {
  const context = useContext(WorkflowFieldsContext),
    id = useId();
  const [local, setLocal] = useState<WorkflowFieldEntry>();
  const entry = context?.entries[fieldKey] ?? local;
  const current = entry?.committedValue === value ? entry : undefined;
  const raw = current?.raw ?? value,
    dirty = raw !== value;
  const edit = (raw: string, error?: string) => {
    const next = { raw, committedValue: value, error };
    if (context) context.edit(fieldKey, next);
    else setLocal(next);
  };
  const discard = () => {
    if (context) context.clear(fieldKey);
    else setLocal(undefined);
  };
  const apply = () => {
    try {
      commit(raw.trim());
      discard();
    } catch (error) {
      edit(raw, `${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const change = (text: string) =>
    edit(text, text === value ? undefined : `${label}: apply or discard this name change.`);
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      discard();
    }
  };
  return { id, raw, dirty, error: current?.error, apply, discard, change, keyDown };
}

export function WorkflowCommittedName(props: NameProps) {
  const { fieldKey, label } = props;
  const { id, raw, dirty, error, apply, discard, change, keyDown } = useCommittedName(props);
  return (
    <div className="setup-name-edit">
      <label htmlFor={id}>
        {label}
        <input
          id={id}
          name={fieldKey}
          value={raw}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          ref={(input) => input?.setCustomValidity(error ?? "")}
          onChange={(event) => change(event.target.value)}
          onKeyDown={keyDown}
        />
      </label>
      <div className="setup-inline-actions">
        <button type="button" disabled={!dirty} onClick={apply}>
          Apply {label.toLowerCase()}
        </button>
        <button type="button" disabled={!dirty} onClick={discard}>
          Discard {label.toLowerCase()} edit
        </button>
      </div>
      {error && (
        <small className="error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}
