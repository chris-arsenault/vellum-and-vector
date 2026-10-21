import type { ComponentType } from "react";
import type { ParameterValues } from "@atlas/domain";
import type {
  SetupFeature,
  GenerationSettings,
  ConfigurationPresentation,
} from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { GenerationEcologyConfiguration } from "./GenerationEpochConfiguration";
import {
  GenerationMagicConfiguration,
  GenerationLocatedSources,
} from "./GenerationMagicConfiguration";
import { GenerationCultureConfiguration } from "./GenerationCultureConfiguration";
import {
  physicalChanges,
  ecologyChanges,
  culturalChanges,
  type ConfigurationChange,
} from "./generationConfigurationChanges";
import { magicConfigurationChanges } from "./generationMagicChanges";
import { epochFieldPrefix } from "./generationEpochFields";
import { GenerationClockInstructions } from "./GenerationTimeline";

interface SummaryInput {
  current?: ParameterValues;
  previous?: ParameterValues;
  settings: GenerationSettings;
  baseline: GenerationSettings;
}
export interface GenerationFeatureAdapter {
  id: string;
  Editor?: ComponentType<{ flow: GenerationWorkflow; feature: SetupFeature }>;
  summarize?(input: SummaryInput): ConfigurationChange[];
  fieldKey?(path: (string | number)[], configuration: ParameterValues): string | undefined;
  ownsField?(key: string): boolean;
}
const adapters = new Map<string, GenerationFeatureAdapter>();
export function registerGenerationFeatureAdapter(adapter: GenerationFeatureAdapter) {
  if (adapters.has(adapter.id)) throw new Error(`Duplicate setup adapter ${adapter.id}.`);
  adapters.set(adapter.id, adapter);
  return () => adapters.delete(adapter.id);
}
export function generationFeatureAdapter(id: string) {
  return adapters.get(id);
}
export function adapterFieldOwner(key: string) {
  return [...adapters.values()].find((adapter) => adapter.ownsField?.(key))?.id;
}
export function configurationFieldKey(feature: SetupFeature, path: (string | number)[]) {
  const specialized = generationFeatureAdapter(feature.id)?.fieldKey;
  if (specialized && feature.configuration) return specialized(path, feature.configuration);
  const binding = feature.configurationPresentation?.epochs;
  if (binding?.path === path[0] && feature.configuration) {
    return epochConfigurationKey(feature.id, binding, feature.configuration, path);
  }
  return `feature.${feature.id}.${path.join(".")}`;
}
function epochConfigurationKey(
  feature: string,
  binding: NonNullable<ConfigurationPresentation["epochs"]>,
  configuration: ParameterValues,
  path: (string | number)[]
) {
  if (path.length < 3) return undefined;
  const values = configuration[binding.path];
  const id =
    binding.shape === "clock"
      ? (values as unknown as { id: string }[])[Number(path[1])]?.id
      : String(path[1]);
  return id === undefined ? undefined : epochFieldPrefix(feature, id) + path.slice(2).join(".");
}
function magicField(path: (string | number)[], configuration: ParameterValues) {
  if (path[0] === "magicSystems") {
    if (path.length < 3) return undefined;
    const system = (
      configuration.magicSystems as unknown as import("@atlas/domain").MagicSystem[]
    ).find((item, index) =>
      typeof path[1] === "number" ? index === path[1] : item.id === path[1]
    );
    if (!system) return undefined;
    if (path[2] === "features") {
      if (path.length < 5) return undefined;
      const rule = system.features.find((item, index) =>
        typeof path[3] === "number" ? index === path[3] : item.id === path[3]
      );
      if (!rule) return undefined;
      return `magic.${system.id}.rules.${rule.id}.${path.slice(4).join(".")}`;
    }
    return `magic.${system.id}.${path.slice(2).join(".")}`;
  }
  if (path[0] === "activity")
    return `${epochFieldPrefix("magic.configured", String(path[1]))}activity.${path.slice(2).join(".")}`;
  return `feature.magic.configured.${path.join(".")}`;
}
const builtins: GenerationFeatureAdapter[] = [
  {
    id: "physical.lifecycle",
    Editor: GenerationClockInstructions,
    summarize: ({ settings, baseline }) => physicalChanges(settings.epochs, baseline.epochs),
  },
  {
    id: "physical.climate",
    summarize: ({ settings, baseline }) =>
      ecologyChanges(settings.epochs, baseline.epochs, ["rainfall"]),
    ownsField: (key) =>
      key.startsWith("feature.ecology.living.epochs.") && key.endsWith(".rainfall"),
  },
  {
    id: "ecology.living",
    Editor: GenerationEcologyConfiguration,
    summarize: ({ settings, baseline }) => ecologyChanges(settings.epochs, baseline.epochs),
  },
  {
    id: "magic.configured",
    Editor: GenerationMagicConfiguration,
    summarize: ({ settings, baseline }) => magicConfigurationChanges(settings, baseline),
    fieldKey: magicField,
    ownsField: (key) => key.startsWith("magic."),
  },
  { id: "magic.local", Editor: GenerationLocatedSources },
  {
    id: "human.cultures",
    Editor: GenerationCultureConfiguration,
    summarize: ({ settings, baseline }) => culturalChanges(settings.humanEras, baseline.humanEras),
    fieldKey: (path) =>
      path.length < 3
        ? undefined
        : `human.${path.map((part, index) => (index === 2 && part === "id" ? "name" : part)).join(".")}`,
    ownsField: (key) => key.startsWith("human."),
  },
];
for (const adapter of builtins) registerGenerationFeatureAdapter(adapter);
