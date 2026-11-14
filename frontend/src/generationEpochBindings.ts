import { type GenerationFeature, type FeatureSelection } from "./generationTypes";
import { atlasFeatureDefinitions } from "./generationPresentation";
import type { Epoch } from "@atlas/context";
import type { ParameterValues } from "./generationTypes";
import { requireFormValue } from "./values";

export function draftEpochBindings(
  definitions: readonly Pick<
    GenerationFeature,
    "id" | "configurationPresentation"
  >[] = atlasFeatureDefinitions
) {
  return definitions.flatMap((feature) =>
    feature.configurationPresentation?.epochs
      ? [{ id: feature.id, ...feature.configurationPresentation.epochs }]
      : []
  );
}
export function sharedClock(selection: FeatureSelection) {
  const binding = draftEpochBindings().find((entry) => entry.shape === "clock");
  requireFormValue(binding, "Register a shared generation clock.");
  return selection[binding.id].configuration![binding.path] as unknown as Epoch[];
}
export function rebindDraftEpochs(
  selection: FeatureSelection,
  epochs: Epoch[],
  identities: Record<string, string> = {},
  definitions: readonly Pick<
    GenerationFeature,
    "id" | "configurationPresentation"
  >[] = atlasFeatureDefinitions
): FeatureSelection {
  const next = { ...selection };
  for (const binding of draftEpochBindings(definitions)) {
    const previous = selection[binding.id];
    if (!previous) continue;
    const config = previous.configuration!;
    const records = config[binding.path] as Record<string, ParameterValues[string]>;
    const value =
      binding.shape === "clock"
        ? epochs.map(({ ecology: _ecology, magicActivity: _magic, ...physical }) => {
            void _ecology;
            void _magic;
            return physical;
          })
        : Object.fromEntries(
            epochs.map((epoch) => [
              epoch.id,
              Object.keys(identities).length
                ? (records[identities[epoch.id] ?? epoch.id] ?? {})
                : binding.extension
                  ? (epoch[binding.extension] ?? {})
                  : (records[identities[epoch.id] ?? epoch.id] ?? {}),
            ])
          );
    next[binding.id] = {
      ...previous,
      configuration: { ...config, [binding.path]: value as ParameterValues[string] },
    };
  }
  return next;
}
