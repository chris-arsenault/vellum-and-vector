import {
  cloneSnapshot,
  isNumericalVector,
  requireThat,
  type NumericalAllocator,
} from "@atlas/domain";
import type { GenerationState } from "./process";
import type { MapRunnerOptions } from "./mapRunner";
import { generationNumericalState } from "./generationNumericalState";
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
  const state = generationWorkingState(initial, options.numerical, owned);
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
export function numericalProcessLifetime(numerical?: NumericalAllocator, state?: GenerationState) {
  const start = numerical?.beginProcess();
  const previous = numerical && state ? generationNumericalState(state) : [];
  return () => {
    if (numerical && state) numerical.releaseUnused(previous, generationNumericalState(state));
    numerical?.releaseProcess(start);
  };
}

export function generationWorkingState(
  initial: GenerationState,
  numerical: NumericalAllocator | undefined,
  owned: boolean
): GenerationState {
  return {
    ...(owned ? initial : copyWorkingState(initial, numerical)),
    domain: cloneSnapshot(initial.domain),
    history: structuredClone(initial.history),
    causes: structuredClone(initial.causes),
    numerical,
  };
}

function copyWorkingState(initial: GenerationState, numerical?: NumericalAllocator) {
  const copies = new Map<object, unknown>();
  const mesh = initial.physical?.map.mesh;
  // Lattice addresses are immutable after construction. Keep their column views and lookup
  // behavior; structuredClone cannot represent them and expanding them would rebuild the mesh.
  if (mesh) {
    copies.set(mesh.coords, mesh.coords);
    copies.set(mesh.indexes, mesh.indexes);
  }
  if (initial.numerical) copies.set(initial.numerical, numerical);
  if (initial.physical?.map.numerical) copies.set(initial.physical.map.numerical, numerical);
  return copyValue(
    { ...initial, domain: undefined, numerical: undefined },
    copies
  ) as GenerationState;
}
function copyValue(value: unknown, copies: Map<object, unknown>): unknown {
  if (!value || typeof value !== "object") return value;
  if (copies.has(value)) return copies.get(value);
  if (isNumericalVector(value)) {
    const copy = value.slice();
    copy.retain?.();
    copies.set(value, copy);
    return copy;
  }
  return copyContainer(value, copies);
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
