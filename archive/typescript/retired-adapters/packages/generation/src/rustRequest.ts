import type { DomainSnapshot } from "@atlas/domain";
import type { AtlasGenerationInput } from "./atlasWorkflow";

/** Platform binding only: Rust resolves choices and reads the pinned private resource references. */
export function prepareRustGeneration(source: DomainSnapshot, input: AtlasGenerationInput) {
  return {
    source,
    request: {
      source: { ...source, numerical: undefined },
      input: {
        areaId: input.areaId,
        domains: input.domains,
        quality: input.quality,
        seed: input.seed,
        parameters: input.parameters,
        features: input.features,
        settings: input.settings,
        configuration: input.configuration,
      },
    },
  };
}
