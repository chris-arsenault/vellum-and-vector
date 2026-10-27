import type {
  AtlasFeature,
  DomainSnapshot,
  FeatureSelection,
  FeatureWorkspace,
  FeatureReader,
} from "@atlas/domain";
import { featureWorkspaceWorld, proceduralFeature } from "@atlas/domain";
import type { GenerationState } from "./process";

type State = Pick<GenerationState, "domain" | "features">;
export function initializeFeatureWorkspace(state: State, features?: FeatureWorkspace) {
  if (!features) return;
  for (const feature of Object.values(state.domain.world.features)) features.put(feature);
  state.domain.world.features = {};
  state.features = features;
}
export function* generationFeatures(state: State, selection: FeatureSelection = {}) {
  if (state.features) {
    yield* state.features.values(selection);
    return;
  }
  for (const feature of Object.values(state.domain.world.features))
    if (
      Object.entries(selection).every(
        ([key, value]) => feature[key as keyof FeatureSelection] === value
      )
    )
      yield feature;
}
export function generationFeature(state: State, id: string) {
  return state.features ? state.features.get(id) : state.domain.world.features[id];
}
export function findGenerationFeature(state: State, predicate: (feature: AtlasFeature) => boolean) {
  for (const feature of generationFeatures(state)) if (predicate(feature)) return feature;
}
export function writeGenerationFeature(state: State, feature: AtlasFeature) {
  if (state.features) state.features.put(feature);
  else state.domain.world.features[feature.id] = feature;
}
export function removeGenerationFeature(state: State, id: string) {
  if (state.features) state.features.remove(id);
  else delete state.domain.world.features[id];
}
export function featureRevisions(state: State): Iterable<[string, unknown]> {
  return state.features?.revisions() ?? Object.entries(state.domain.world.features);
}
/** Compose one subject with only the records its following relationships require. */
export function generationFeatureWorld(state: State, ids: Iterable<string>) {
  return state.features
    ? featureWorkspaceWorld(state.domain.world, state.features, ids)
    : state.domain.world;
}

/** Validation compares the procedural baseline; map-only drawings are restored at publication. */
export function originalFeatureReader(
  state: Pick<GenerationState, "sourceFeatures">,
  original: DomainSnapshot
): FeatureReader {
  return {
    get(id) {
      if (!state.sourceFeatures) return original.world.features[id];
      const feature = state.sourceFeatures.get(id);
      return feature && proceduralFeature(feature);
    },
    *values(selection) {
      if (!state.sourceFeatures) {
        yield* generationFeatures({ domain: original }, selection);
        return;
      }
      for (const feature of state.sourceFeatures.values(selection)) {
        const value = proceduralFeature(feature);
        if (value) yield value;
      }
    },
  };
}
