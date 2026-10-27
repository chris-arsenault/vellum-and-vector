import {
  worldNetworkReader,
  type DomainSnapshot,
  type NetworkNode,
  type NetworkReach,
  type NetworkWorkspace,
} from "@atlas/domain";
import type { GenerationState } from "./process";

type State = Pick<GenerationState, "domain" | "networks" | "sourceNetworks" | "sourceFeatures">;
export function generationNetworks(state: State) {
  return state.networks ?? worldNetworkReader(state.domain.world);
}
export function originalNetworks(state: State, original: DomainSnapshot) {
  const reader = state.sourceNetworks ?? worldNetworkReader(original.world);
  return {
    node: (id: string) => reader.node(id),
    nodes: () => reader.nodes(),
    *reaches(selection?: import("@atlas/domain").ReachSelection) {
      for (const reach of reader.reaches(selection))
        if (!state.sourceFeatures?.get(reach.featureId)?.mapOnly) yield reach;
    },
  };
}
export function writeGenerationNode(state: State, node: NetworkNode) {
  if (state.networks) state.networks.putNode(node);
  else (state.domain.world.networkNodes ??= {})[node.id] = node;
}
export function writeGenerationReach(state: State, reach: NetworkReach) {
  if (state.networks) state.networks.putReach(reach);
  else (state.domain.world.networkReaches ??= {})[reach.id] = reach;
}
export function removeGenerationReach(state: State, id: string) {
  if (state.networks) state.networks.removeReach(id);
  else delete state.domain.world.networkReaches?.[id];
}
export function initializeNetworkWorkspace(state: State, networks?: NetworkWorkspace) {
  if (!networks) return;
  for (const node of Object.values(state.domain.world.networkNodes ?? {})) networks.putNode(node);
  for (const reach of Object.values(state.domain.world.networkReaches ?? {}))
    networks.putReach(reach);
  state.domain.world.networkNodes = {};
  state.domain.world.networkReaches = {};
  state.networks = networks;
  if (!state.sourceNetworks) return;
  const original = originalNetworks(state, state.domain);
  for (const node of original.nodes()) networks.putNode(node);
  for (const reach of original.reaches()) networks.putReach(reach);
}
