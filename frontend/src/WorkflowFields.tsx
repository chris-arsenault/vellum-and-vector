import { useContext, useId, useMemo, useState, type ReactNode } from "react";
import {
  WorkflowFieldsContext,
  validateWorkflowNumber,
  validateWorkflowCodes,
  removeWorkflowIndex,
  type NumberRules,
  type WorkflowFieldEntry,
} from "./workflowFieldState";

export function WorkflowFieldProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, WorkflowFieldEntry>>({});
  const state = useMemo(
    () => ({
      entries,
      errors: Object.fromEntries(
        Object.entries(entries).flatMap(([key, entry]) => (entry.error ? [[key, entry.error]] : []))
      ),
      edit(key: string, entry: WorkflowFieldEntry) {
        setEntries((previous) => ({ ...previous, [key]: entry }));
      },
      clear(prefix?: string) {
        setEntries((previous) =>
          prefix === undefined
            ? {}
            : Object.fromEntries(
                Object.entries(previous).filter(([key]) => !key.startsWith(prefix))
              )
        );
      },
      clearExact(key: string) {
        setEntries((previous) =>
          Object.fromEntries(Object.entries(previous).filter(([name]) => name !== key))
        );
      },
      removeIndex(prefix: string, index: number) {
        setEntries((previous) => removeWorkflowIndex(previous, prefix, index));
      },
    }),
    [entries]
  );
  return <WorkflowFieldsContext.Provider value={state}>{children}</WorkflowFieldsContext.Provider>;
}

type NumberFieldProps = NumberRules & {
  label: string;
  fieldKey: string;
  unit?: string;
  disabled?: boolean;
  readOnly?: boolean;
} & (
    | { optional?: false; value: number; change(value: number): void }
    | { optional: true; value?: number; change(value: number | undefined): void }
  );

/** Incomplete text stays separate from the last valid generation setting. */
export function NumberField(props: NumberFieldProps) {
  const context = useContext(WorkflowFieldsContext),
    [local, setLocal] = useState<WorkflowFieldEntry>(),
    id = useId();
  const { raw, error } = numberDisplay(props.value, context?.entries[props.fieldKey] ?? local);
  const edit = (text: string) => {
    const result = validateWorkflowNumber(text, props);
    const next = {
      raw: text,
      committedValue: result.error ? props.value : result.value,
      error: result.error ? `${props.label}: ${result.error}` : undefined,
    };
    if (context) context.edit(props.fieldKey, next);
    else setLocal(next);
    if (!result.error) {
      if (props.optional) props.change(result.value);
      else props.change(result.value!);
    }
  };
  return (
    <label className="workflow-number-field" htmlFor={id}>
      <span id={`${id}-label`}>
        {props.label}
        {props.unit ? ` · ${props.unit}` : ""}
      </span>
      <input
        id={id}
        name={props.fieldKey}
        type="text"
        inputMode="decimal"
        value={raw}
        disabled={props.disabled}
        readOnly={props.readOnly}
        aria-invalid={Boolean(error)}
        aria-labelledby={`${id}-label`}
        aria-describedby={error ? `${id}-error` : undefined}
        ref={(input) => input?.setCustomValidity(error ?? "")}
        onChange={(event) => edit(event.target.value)}
      />
      {error && (
        <small className="error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </label>
  );
}
function numberDisplay(value: number | string | undefined, entry?: WorkflowFieldEntry) {
  const current = entry && Object.is(entry.committedValue, value) ? entry : undefined;
  return { raw: current?.raw ?? String(value ?? ""), error: current?.error };
}

export function CodeField({
  fieldKey,
  label,
  value,
  change,
}: {
  fieldKey: string;
  label: string;
  value?: number[];
  change(value: number[] | undefined): void;
}) {
  const context = useContext(WorkflowFieldsContext),
    [local, setLocal] = useState<WorkflowFieldEntry>(),
    id = useId(),
    committed = value?.join(",") ?? "";
  const { raw, error } = numberDisplay(committed, context?.entries[fieldKey] ?? local);
  const edit = (text: string) => {
    const result = validateWorkflowCodes(text),
      next = {
        raw: text,
        committedValue: result.error ? committed : (result.values?.join(",") ?? ""),
        error: result.error ? `${label}: ${result.error}` : undefined,
      };
    if (context) context.edit(fieldKey, next);
    else setLocal(next);
    if (!result.error) change(result.values);
  };
  return (
    <label htmlFor={id}>
      <span id={`${id}-label`}>{label}</span>
      <input
        id={id}
        name={fieldKey}
        value={raw}
        aria-invalid={Boolean(error)}
        aria-labelledby={`${id}-label`}
        aria-describedby={error ? `${id}-error` : undefined}
        ref={(input) => input?.setCustomValidity(error ?? "")}
        onChange={(event) => edit(event.target.value)}
      />
      {error && (
        <small className="error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </label>
  );
}
