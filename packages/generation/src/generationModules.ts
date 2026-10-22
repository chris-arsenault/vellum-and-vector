import {
  requireThat,
  sameValue,
  type DomainSnapshot,
  type World,
  type Diagnostic,
  type ParameterValues,
} from "@atlas/domain";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import type { GenerationSettings } from "./generationSettings";
import {
  featureContribution,
  type FeatureSelection,
  type GenerationFeature,
  type ResolvedFeatures,
  type FeatureContributionContext,
  type FeatureRequirement,
} from "./features";
import type { MapProcess, ProcessSequence } from "./process";
import type { PublicationDefinition } from "./publication";
import { generationSlots, type GenerationSlot } from "./generationSlots";
import type { AtlasParameters } from "./atlasParameters";

/** Static application modules are imported identically by browser and worker. */
export interface GenerationModule {
  id: string;
  features: GenerationFeature[];
  processes?(source: DomainSnapshot, input: AtlasGenerationInput): MapProcess[];
  publications?(input: AtlasGenerationInput, world: World): PublicationDefinition[];
}
export class GenerationModuleRegistry {
  private readonly modules = new Map<string, GenerationModule>();
  private readonly catalog: GenerationFeature[] = [];
  register(module: GenerationModule): this {
    requireThat(!this.modules.has(module.id), "generation_module", `Register ${module.id} once.`);
    const ids = new Set(this.features().map((feature) => feature.id));
    for (const feature of module.features) {
      requireThat(!ids.has(feature.id), "feature_identity", `Register ${feature.id} once.`);
      for (const slot of feature.slots)
        requireThat(
          generationSlots.includes(slot),
          "generation_slot",
          `Unknown causal slot ${slot} on ${feature.id}.`
        );
      ids.add(feature.id);
    }
    this.modules.set(module.id, module);
    this.catalog.push(...module.features);
    return this;
  }
  unregister(id: string) {
    const owned = new Set(this.modules.get(id)?.features ?? []);
    this.modules.delete(id);
    for (let index = this.catalog.length - 1; index >= 0; index--)
      if (owned.has(this.catalog[index])) this.catalog.splice(index, 1);
  }
  features() {
    return this.catalog;
  }
  processes(source: DomainSnapshot, input: AtlasGenerationInput) {
    return [...this.modules.values()].flatMap((module) => module.processes?.(source, input) ?? []);
  }
  publications(input: AtlasGenerationInput, world: World) {
    return [...this.modules.values()].flatMap(
      (module) => module.publications?.(input, world) ?? []
    );
  }
  contribute(
    slot: string,
    resolved: ResolvedFeatures,
    context?: FeatureContributionContext
  ): ProcessSequence {
    requireThat(
      generationSlots.includes(slot as GenerationSlot),
      "generation_slot",
      `Unknown causal slot ${slot}.`
    );
    return this.features().flatMap((feature) =>
      featureContribution(feature, slot, resolved, context)
    );
  }
  bindSettings(features: ResolvedFeatures, legacy: GenerationSettings) {
    return this.features().reduce(
      (settings, feature) =>
        bindConfiguration(
          feature,
          features.selection[feature.id]?.configuration,
          settings,
          "bind",
          features.parameters
        ),
      structuredClone(legacy)
    );
  }
  prepareSettings(selected: FeatureSelection, legacy: GenerationSettings) {
    return this.features().reduce(
      (settings, feature) =>
        bindConfiguration(feature, selected[feature.id]?.configuration, settings, "prepare"),
      structuredClone(legacy)
    );
  }
  requirements(id: string, context: FeatureContributionContext): FeatureRequirement[] {
    const feature = this.features().find((item) => item.id === id);
    requireThat(feature, "unknown_feature", `Unknown generation feature ${id}.`);
    return [
      ...(feature.requires ?? []).map((required) => ({ feature: required })),
      ...(feature.conditionalRequires?.(context.resolved.selection[id]?.configuration, context) ??
        []),
    ];
  }
  dependencyDiagnostics(context: FeatureContributionContext): Diagnostic[] {
    return this.features().flatMap((feature) => {
      if (!context.resolved.selection[feature.id]?.enabled) return [];
      const missing = this.requirements(feature.id, context).filter(
        (required) => !context.resolved.selection[required.feature]?.enabled
      );
      return [
        ...missing.map((required) => ({
          severity: "error" as const,
          code: "feature_dependency",
          invocation: feature.id,
          resource: required.feature,
          field: required.field,
          message:
            required.message ??
            `${feature.label} requires ${required.feature}. Enable it or disable ${feature.id}.`,
        })),
        ...(feature.diagnostics?.(context.resolved.selection[feature.id]?.configuration, context) ??
          []),
      ];
    });
  }
}

function bindConfiguration(
  feature: GenerationFeature,
  configuration: ParameterValues | undefined,
  settings: GenerationSettings,
  operation: "prepare" | "bind",
  parameters?: AtlasParameters
) {
  const binding = feature.configurationBinding,
    apply = binding?.[operation];
  if (!binding || !apply || !configuration) return settings;
  const patch =
    operation === "bind"
      ? binding.bind(structuredClone(configuration), structuredClone(settings), parameters!)
      : binding.prepare!(structuredClone(configuration), structuredClone(settings));
  for (const key of Object.keys(patch))
    requireThat(
      binding.fields.includes(key as keyof GenerationSettings) ||
        (key === "epochs" && validEpochPatch(binding.epochFields, patch.epochs!, settings.epochs)),
      "feature_configuration_ownership",
      `${feature.id} cannot configure unowned setting ${key}.`
    );
  return { ...settings, ...patch };
}
function validEpochPatch(
  fields: readonly string[] | undefined,
  next: GenerationSettings["epochs"],
  previous: GenerationSettings["epochs"]
) {
  if (!fields?.length) return false;
  const unowned = (epochs: GenerationSettings["epochs"]) =>
    epochs.map((epoch) =>
      Object.fromEntries(Object.entries(epoch).filter(([key]) => !fields.includes(key)))
    );
  return sameValue(unowned(next), unowned(previous));
}
export const atlasGenerationModules = new GenerationModuleRegistry();
