import { createContext, useContext } from "react";

export interface NumberRules {
  optional?: boolean;
  min?: number;
  max?: number;
  step?: number | "any";
}
export interface WorkflowFieldEntry {
  raw: string;
  committedValue: number | string | undefined;
  error?: string;
}
export interface WorkflowFieldState {
  entries: Record<string, WorkflowFieldEntry>;
  errors: Record<string, string>;
  edit(key: string, entry: WorkflowFieldEntry): void;
  clear(prefix?: string): void;
  clearExact(key: string): void;
  removeIndex(prefix: string, index: number): void;
}
export const WorkflowFieldsContext = createContext<WorkflowFieldState | null>(null);
const outsideWorkflow: Pick<WorkflowFieldState, "errors" | "clear" | "clearExact" | "removeIndex"> =
  {
    errors: {},
    clear() {},
    clearExact() {},
    removeIndex() {},
  };
export function useWorkflowFields() {
  return useContext(WorkflowFieldsContext) ?? outsideWorkflow;
}

export function validateWorkflowNumber(raw: string, rules: NumberRules) {
  if (!raw.trim()) return rules.optional ? { value: undefined } : { error: "Enter a number." };
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: "Enter a finite number." };
  const error = numberBounds(value, rules) ?? numberStep(value, rules);
  return error ? { error } : { value };
}
function numberBounds(value: number, rules: NumberRules) {
  if (rules.min === Number.MIN_VALUE && value <= 0) return "Use a positive number.";
  if (rules.min !== undefined && value < rules.min) return `Use ${rules.min} or greater.`;
  if (rules.max !== undefined && value > rules.max) return `Use ${rules.max} or less.`;
}
function numberStep(value: number, rules: NumberRules) {
  const step = rules.step;
  if (typeof step === "number" && step > 0) {
    const increments = (value - (rules.min ?? 0)) / step;
    if (Math.abs(increments - Math.round(increments)) > 1e-8)
      return `Use increments of ${step} from ${rules.min ?? 0}.`;
  }
}

export function removeWorkflowIndex(
  entries: Record<string, WorkflowFieldEntry>,
  prefix: string,
  index: number
) {
  return Object.fromEntries(
    Object.entries(entries).flatMap(([key, entry]) => {
      if (!key.startsWith(`${prefix}.`)) return [[key, entry]];
      const [position, ...suffix] = key.slice(prefix.length + 1).split("."),
        ordinal = Number(position);
      if (ordinal === index) return [];
      const next = ordinal > index ? `${prefix}.${ordinal - 1}.${suffix.join(".")}` : key;
      return [[next, entry]];
    })
  );
}

export function validateWorkflowCodes(raw: string) {
  if (!raw.trim()) return { values: undefined };
  const tokens = raw.split(","),
    values = tokens.map(Number);
  return tokens.some((token) => !token.trim()) || values.some((value) => !Number.isFinite(value))
    ? { error: "Enter comma-separated finite numbers." }
    : { values };
}
