import {
  Band,
  BlockCache,
  Coverage,
  cloneSnapshot,
  requireThat,
  type Lattice,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import type { MapRunnerOptions } from "./mapRunner";
import { generationBands, generationGridBands } from "./generationNumericalState";
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
  const state = generationWorkingState(initial, owned, options.cache);
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
  owned: boolean,
  cache?: BlockCache
): GenerationState {
  return {
    ...(owned ? initial : copyWorkingState(initial)),
    domain: cloneSnapshot(initial.domain),
    history: structuredClone(initial.history),
    causes: structuredClone(initial.causes),
    cache: cache ?? initial.cache,
  };
}
/** Coverages snapshot copy-on-write; each reachable band maps to its copy in the new coverage. */
function snapshotCoverage(
  coverage: Coverage,
  members: Iterable<Band>,
  copies: Map<object, unknown>
) {
  const bandCopies = new Map<Band, Band>(),
    copy = coverage.snapshot(bandCopies);
  copies.set(coverage, copy);
  for (const [band, snapshot] of bandCopies) if (!copies.has(band)) copies.set(band, snapshot);
  for (const band of members) if (!copies.has(band)) copies.set(band, copy.copyBand(band));
}
function copyWorkingState(initial: GenerationState) {
  const copies = new Map<object, unknown>();
  const map = initial.physical?.map;
  if (map) {
    // The lattice is immutable; the coverage and its bands snapshot copy-on-write.
    copies.set(map.mesh, map.mesh);
    snapshotCoverage(map.coverage, generationBands(initial), copies);
  }
  for (const [coverage, members] of generationGridBands(initial))
    snapshotCoverage(coverage, members, copies);
  return copyValue({ ...initial, domain: undefined, cache: undefined }, copies) as GenerationState;
}
function copyValue(value: unknown, copies: Map<object, unknown>): unknown {
  if (!value || typeof value !== "object") return value;
  if (copies.has(value)) return copies.get(value);
  if (value instanceof Band || value instanceof Coverage || isLattice(value)) return value;
  if (ArrayBuffer.isView(value)) {
    const copy = (value as unknown as { slice(): object }).slice();
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
