import type { GenerationFeature, CartographicControl } from "./generationTypes";
import type { GenerationDraft } from "./generationDraft";
import type { MagicSource, MagicPropagation, MagicSystem, EcologyEpoch } from "@atlas/context";

/** Serialized choice for the human-era physical regime selector. */
export const beforePresentEpoch = "before-present";

/** Immutable UI declarations supplied by the selected execution host before opening setup. */
export type FeaturePresentation = Omit<GenerationFeature, "configuration"> & {
  configurable: boolean;
  epochDefaults?: EcologyEpoch;
  magicPresentation?: {
    dimensions: Record<keyof MagicSystem["parameters"], number>;
    sources: {
      value: MagicSource;
      label: string;
      parameters: (keyof MagicSystem["parameters"])[];
      radiusParameter?: keyof MagicSystem["parameters"];
    }[];
    propagations: {
      value: MagicPropagation;
      label: string;
      parameters: (keyof MagicSystem["parameters"])[];
      usesSourceRadius?: boolean;
    }[];
    coastal: (keyof MagicSystem["parameters"])[];
  };
};
export const atlasFeatureDefinitions: FeaturePresentation[] = [];
let defaults: GenerationDraft;
export function installGenerationPresentation(features: unknown[], draft: GenerationDraft) {
  atlasFeatureDefinitions.splice(
    0,
    atlasFeatureDefinitions.length,
    ...(features as FeaturePresentation[])
  );
  defaults = draft;
}
export function defaultEpoch() {
  return structuredClone(defaults.recipe.settings.epochs[0]);
}
export function defaultMagicConfiguration() {
  return structuredClone(defaults.recipe.features!["magic.configured"].configuration!);
}
export function defaultEcologyEpoch() {
  return atlasFeatureDefinitions.find((feature) => feature.id === "ecology.living")!.epochDefaults!;
}
export function magicPresentation() {
  return atlasFeatureDefinitions.find((feature) => feature.id === "magic.configured")!
    .magicPresentation!;
}
export function controlFeatures(control: CartographicControl) {
  return [...new Set(control.choices.flatMap((choice) => Object.keys(choice.features)))];
}
