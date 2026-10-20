import { requireThat, type DomainSnapshot, type World } from "@atlas/domain";
import type { AtlasGenerationInput } from "./atlasWorkflow";
import type { GenerationSettings } from "./generationSettings";
import {
  featureContribution,
  type FeatureSelection,
  type GenerationFeature,
  type ResolvedFeatures,
} from "./features";
import type { MapProcess, ProcessSequence } from "./process";
import type { PublicationDefinition } from "./publication";

/** Static application modules are imported identically by browser and worker. */
export interface GenerationModule {
  id: string;
  features: GenerationFeature[];
  processes?(source: DomainSnapshot, input: AtlasGenerationInput): MapProcess[];
  publications?(input: AtlasGenerationInput, world: World): PublicationDefinition[];
  bindSettings?(features: ResolvedFeatures, legacy: GenerationSettings): GenerationSettings;
  prepareSettings?(selected: FeatureSelection, legacy: GenerationSettings): GenerationSettings;
}
export class GenerationModuleRegistry {
  private readonly modules = new Map<string, GenerationModule>();
  private readonly catalog: GenerationFeature[] = [];
  register(module: GenerationModule): this {
    requireThat(!this.modules.has(module.id), "generation_module", `Register ${module.id} once.`);
    const ids = new Set(this.features().map((feature) => feature.id));
    for (const feature of module.features) {
      requireThat(!ids.has(feature.id), "feature_identity", `Register ${feature.id} once.`);
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
  contribute(slot: string, resolved: ResolvedFeatures): ProcessSequence {
    return this.features().flatMap((feature) => featureContribution(feature, slot, resolved));
  }
  bindSettings(features: ResolvedFeatures, legacy: GenerationSettings) {
    return [...this.modules.values()].reduce(
      (settings, module) => module.bindSettings?.(features, settings) ?? settings,
      structuredClone(legacy)
    );
  }
  prepareSettings(selected: FeatureSelection, legacy: GenerationSettings) {
    return [...this.modules.values()].reduce(
      (settings, module) => module.prepareSettings?.(selected, settings) ?? settings,
      structuredClone(legacy)
    );
  }
}
export const atlasGenerationModules = new GenerationModuleRegistry();
