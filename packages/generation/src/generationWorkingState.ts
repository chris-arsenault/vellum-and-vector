import { Band, BlockCache, Coverage, cloneSnapshot, requireThat } from "@atlas/domain";
import type { GenerationState } from "./process";
import type { MapRunnerOptions } from "./mapRunner";
import { generationBands, generationGridBands } from "./generationNumericalState";
import { initializeFeatureWorkspace, originalFeatureReader } from "./generationFeatures";
import { preparePublicationLayers } from "./publication";
import { initializeNetworkWorkspace } from "./generationNetworks";

/**
 * The run takes ownership of the initial state's working parts (physical, society, surface);
 * the domain snapshot, history and causes are copied so validation compares against the
 * original inputs. There is no copy of the working parts: a caller that needs its state
 * afterwards builds another.
 */
export function prepareWorkingState(initial: GenerationState, options: MapRunnerOptions) {
  requireThat(
    !options.sourceFeatures || options.features,
    "feature_workspace",
    "Stored source geography requires a writable feature workspace."
  );
  const state = generationWorkingState(initial, options.cache);
  state.contours = options.contours;
  initializeFeatureWorkspace(state, options.features);
  state.sourceFeatures = options.sourceFeatures;
  state.sourceNetworks = options.sourceNetworks;
  initializeNetworkWorkspace(state, options.networks);
  if (options.sourceFeatures && state.features)
    for (const feature of originalFeatureReader(state, initial.domain).values())
      state.features.put(feature);
  preparePublicationLayers(
    state.domain,
    state.publications ?? [],
    state.domain.scope.areaId,
    state.features
  );
  return state;
}
/**
 * Process boundaries release what the process left behind, in every coverage: bands no longer
 * reachable from the state and process-lifetime bands. Coverages may be created by the
 * process itself (the physical coverage, a replaced surface grid), so they are looked up
 * afterwards and a new one releases all of its process bands.
 */
export function numericalProcessLifetime(state: GenerationState) {
  const gridBefore = generationGridBands(state),
    physical = state.physical?.map.coverage,
    physicalBefore = generationBands(state),
    starts = new Map<Coverage, number>();
  for (const coverage of gridBefore.keys()) starts.set(coverage, coverage.beginProcess());
  if (physical) starts.set(physical, physical.beginProcess());
  return () => {
    const gridAfter = generationGridBands(state),
      after = state.physical?.map.coverage,
      live = new Set<Band>(generationBands(state));
    for (const group of gridAfter.values()) for (const band of group) live.add(band);
    const before = new Set<Band>(physicalBefore);
    for (const group of gridBefore.values()) for (const band of group) before.add(band);
    const coverages = new Set<Coverage>([...gridBefore.keys(), ...gridAfter.keys()]);
    if (physical) coverages.add(physical);
    if (after) coverages.add(after);
    for (const coverage of coverages) {
      coverage.releaseUnused(before, live);
      coverage.releaseProcess(starts.get(coverage) ?? 0);
    }
  };
}

export function generationWorkingState(
  initial: GenerationState,
  cache?: BlockCache
): GenerationState {
  return {
    ...initial,
    domain: cloneSnapshot(initial.domain),
    history: structuredClone(initial.history),
    causes: structuredClone(initial.causes),
    cache: cache ?? initial.cache,
  };
}
