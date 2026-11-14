import type { FeatureSelection } from "./features";
import { sameValue } from "@atlas/domain";
import type { ParameterValues } from "@atlas/domain";

export type CartographicSection = "land" | "environment" | "people";
export interface CartographicChoice {
  id: string;
  label: string;
  features: FeatureSelection;
  resolve?(selection: FeatureSelection): FeatureSelection;
  initialOnly?: boolean;
}
/** Curated intent composes existing configuration; it never implements generation. */
export interface CartographicControl {
  id: string;
  label: string;
  section: CartographicSection;
  explanation: string;
  initialOnly?: boolean;
  choices: readonly CartographicChoice[];
  system?: string;
  defaultChoice?: string;
  fields?: readonly string[];
}

export const choice = (
  id: string,
  label: string,
  features: FeatureSelection
): CartographicChoice => ({ id, label, features });

export function controlFeatures(control: CartographicControl) {
  return [...new Set(control.choices.flatMap((item) => Object.keys(item.features)))];
}

/** Match only the inputs a choice owns; unrelated advanced edits are preserved. */
export function matchCartographicChoice(control: CartographicControl, selection: FeatureSelection) {
  return control.choices.find((item) =>
    Object.entries(item.resolve?.(selection) ?? item.features).every(([id, patch]) => {
      const current = selection[id];
      return (
        current &&
        (patch.enabled === undefined || current.enabled === patch.enabled) &&
        Object.entries(patch.settings ?? {}).every(
          ([key, value]) => current.settings?.[key] === value
        ) &&
        Object.entries(patch.configuration ?? {}).every(([key, value]) =>
          containsValue(current.configuration?.[key], value)
        )
      );
    })
  );
}

function containsValue(current: unknown, expected: unknown): boolean {
  if (!expected || typeof expected !== "object" || Array.isArray(expected))
    return sameValue(current, expected);
  if (!current || typeof current !== "object") return false;
  return Object.entries(expected).every(([key, value]) =>
    containsValue((current as Record<string, unknown>)[key], value)
  );
}

/** Merge only the owned outcome inputs; arrays remain complete authored records. */
export function mergeCartographicConfiguration(
  current: ParameterValues = {},
  patch: ParameterValues
): ParameterValues {
  const result = structuredClone(current);
  for (const [key, value] of Object.entries(patch)) {
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? mergeCartographicConfiguration(
            (current[key] as ParameterValues) ?? {},
            value as ParameterValues
          )
        : structuredClone(value);
  }
  return result;
}

export function applyCartographicSelection(
  selection: FeatureSelection,
  choice: CartographicChoice
): FeatureSelection {
  const result = structuredClone(selection);
  for (const [id, patch] of Object.entries(choice.resolve?.(selection) ?? choice.features)) {
    const previous = result[id];
    result[id] = {
      ...previous,
      ...patch,
      settings: { ...previous?.settings, ...patch.settings },
      ...(patch.configuration
        ? {
            configuration: mergeCartographicConfiguration(
              previous?.configuration,
              patch.configuration
            ),
          }
        : {}),
    };
  }
  return result;
}
