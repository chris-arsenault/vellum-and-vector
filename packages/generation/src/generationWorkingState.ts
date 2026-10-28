import {
  Band,
  BlockCache,
  Coverage,
  cloneSnapshot,
  isNumericalVector,
  requireThat,
  type Lattice,
  type NumericalAllocator,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import type { MapRunnerOptions } from "./mapRunner";
import { generationBands, generationNumericalState } from "./generationNumericalState";
import { initializeFeatureWorkspace, originalFeatureReader } from "./generationFeatures";
import { preparePublicationLayers } from "./publication";
import { initializeNetworkWorkspace } from "./generationNetworks";

export function prepareWorkingState(
  initial: GenerationState,
  options: MapRunnerOptions,
  owned: boolean
) {
  requireThat(
    !options.sourceFeatures || options.features,
    "feature_workspace",
    "Stored source geography requires a writable feature workspace."
  );
  const state = generationWorkingState(initial, options.numerical, owned, options.cache);
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
 * Process boundaries release what the process left behind: grid vectors no longer reachable
 * and process-lifetime allocations, in the allocator and in the physical coverage. The
 * coverage may be created by the process itself, so it is looked up afterwards.
 */
export function numericalProcessLifetime(
  numerical?: NumericalAllocator,
  state?: GenerationState,
  coverage = false
) {
  const releaseAllocator = allocatorProcessLifetime(numerical, state),
    releaseCoverage = coverage && state ? coverageProcessLifetime(state) : () => {};
  return () => {
    releaseAllocator();
    releaseCoverage();
  };
}
function allocatorProcessLifetime(numerical?: NumericalAllocator, state?: GenerationState) {
  const start = numerical?.beginProcess();
  const previous = numerical && state ? generationNumericalState(state) : [];
  return () => {
    if (numerical && state) numerical.releaseUnused(previous, generationNumericalState(state));
    numerical?.releaseProcess(start);
  };
}
function coverageProcessLifetime(state: GenerationState) {
  const physical = state.physical?.map.coverage,
    bandsBefore = physical ? generationBands(state) : new Set<Band>(),
    bandStart = physical?.beginProcess() ?? 0;
  return () => {
    const after = state.physical?.map.coverage;
    if (!after) return;
    if (after === physical) after.releaseUnused(bandsBefore, generationBands(state));
    after.releaseProcess(after === physical ? bandStart : 0);
  };
}

export function generationWorkingState(
  initial: GenerationState,
  numerical: NumericalAllocator | undefined,
  owned: boolean,
  cache?: BlockCache
): GenerationState {
  return {
    ...(owned ? initial : copyWorkingState(initial, numerical)),
    domain: cloneSnapshot(initial.domain),
    history: structuredClone(initial.history),
    causes: structuredClone(initial.causes),
    numerical,
    cache: cache ?? initial.cache,
  };
}

function copyWorkingState(initial: GenerationState, numerical?: NumericalAllocator) {
  const copies = new Map<object, unknown>();
  const map = initial.physical?.map;
  if (map) {
    // The lattice is immutable; the coverage and its bands snapshot copy-on-write.
    copies.set(map.mesh, map.mesh);
    const bandCopies = new Map<Band, Band>(),
      coverage = map.coverage.snapshot(bandCopies);
    copies.set(map.coverage, coverage);
    for (const [band, copy] of bandCopies) copies.set(band, copy);
    for (const band of generationBands(initial))
      if (!copies.has(band)) copies.set(band, coverage.copyBand(band));
  }
  if (initial.numerical) copies.set(initial.numerical, numerical);
  return copyValue(
    { ...initial, domain: undefined, numerical: undefined, cache: undefined },
    copies
  ) as GenerationState;
}
function copyValue(value: unknown, copies: Map<object, unknown>): unknown {
  if (!value || typeof value !== "object") return value;
  if (copies.has(value)) return copies.get(value);
  if (value instanceof Band || value instanceof Coverage || isLattice(value)) return value;
  if (isNumericalVector(value)) {
    const copy = value.slice();
    copy.retain?.();
    copies.set(value, copy);
    return copy;
  }
  return copyContainer(value, copies);
}
function isLattice(value: object): value is Lattice {
  return "blockLive" in value && "neighbor" in value && "cellAt" in value;
}
function copyContainer(value: object, copies: Map<object, unknown>) {
  if (value instanceof Map) {
    const copy = new Map();
    copies.set(value, copy);
    for (const [key, item] of value) copy.set(copyValue(key, copies), copyValue(item, copies));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    copies.set(value, copy);
    for (const item of value) copy.add(copyValue(item, copies));
    return copy;
  }
  const copy = Array.isArray(value) ? [] : {};
  copies.set(value, copy);
  for (const [key, item] of Object.entries(value))
    (copy as Record<string, unknown>)[key] = copyValue(item, copies);
  return copy;
}
