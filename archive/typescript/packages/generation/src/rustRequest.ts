import { DomainError, spatial, type DomainSnapshot, type FeatureReader } from "@atlas/domain";
import { prepareAtlasGeneration, type AtlasGenerationInput } from "./atlasWorkflow";
import { prepareRegionalRefinement } from "./regional/workflow";
import { isRegionalRefinement } from "./regional/capture";
import { worldGenerationSettings } from "./generationSettings";
import { atlasGenerationModules } from "./atlasModules";
import { rustRequestFrame } from "./rustRequestFrame";

/** Configuration and canonical metadata stay in the application; no cell values enter this request. */
export function prepareRustGeneration(
  source: DomainSnapshot,
  input: AtlasGenerationInput,
  sourceFeatures?: FeatureReader
) {
  const regional = isRegionalRefinement(source, input.areaId),
    prepared = regional
      ? prepareRegionalRefinement(source, input)
      : prepareAtlasGeneration(source, input, sourceFeatures);
  if (prepared.diagnostics.some((diagnostic) => diagnostic.severity === "error"))
    throw new DomainError(
      "generation_configuration",
      prepared.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
      prepared.diagnostics
    );
  const frame = rustRequestFrame(prepared.source, prepared.input),
    publications = atlasGenerationModules.publications(prepared.input, frame.source.world);
  return {
    source: frame.source,
    input: prepared.input,
    diagnostics: prepared.diagnostics,
    publications,
    request: request(frame, source, input),
  };
}
function request(
  frame: ReturnType<typeof rustRequestFrame>,
  original: DomainSnapshot,
  requested: AtlasGenerationInput
) {
  const source = frame.source,
    world = source.world;
  return {
    naming: { seed: String(world.seed), domain: spatial.bounds(world.reference.domain) },
    geography: { ...world, areas: original.world.areas },
    capture: capture(source),
    input: {
      areaId: requested.areaId,
      domains: requested.domains,
      quality: requested.quality,
      seed: requested.seed,
      parameters: requested.parameters,
      features: requested.features,
      settings: requested.settings,
      configuration: requested.configuration,
    },
    history: worldGenerationSettings(original.world),
    existing: original.world.generations.some((run) => run.areaId === requested.areaId),
    landmarks: world.landmarks,
    magicSources: world.magic,
    entities: world.entities,
  };
}
function capture(source: DomainSnapshot) {
  const drainage = source.world.drainage?.[source.scope.areaId];
  return {
    inputs: {
      reads: Object.entries(source.numerical).map(([id, grid]) => ({
        id,
        names: Object.keys(grid.channels),
      })),
      patches: source.fieldPatches,
    },
    reopened: false,
    retainedRivers: !drainage?.input ? (drainage?.kept ?? null) : null,
    drainage: drainage ?? null,
  };
}
