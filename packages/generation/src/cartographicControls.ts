import type { FeatureSelection } from "./features";
import { sameValue } from "@atlas/domain";

export type CartographicSection = "land" | "environment" | "people";
export interface CartographicChoice {
  id: string;
  label: string;
  features: FeatureSelection;
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
    Object.entries(item.features).every(([id, patch]) => {
      const current = selection[id];
      return (
        current &&
        (patch.enabled === undefined || current.enabled === patch.enabled) &&
        Object.entries(patch.settings ?? {}).every(
          ([key, value]) => current.settings?.[key] === value
        ) &&
        Object.entries(patch.configuration ?? {}).every(([key, value]) =>
          sameValue(current.configuration?.[key], value)
        )
      );
    })
  );
}
