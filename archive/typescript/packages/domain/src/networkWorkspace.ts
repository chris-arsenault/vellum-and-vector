import type { NetworkNode, NetworkReach, World } from "./model";

export interface ReachSelection {
  featureId?: string;
  nodeId?: string;
}
export interface NetworkReader {
  node(id: string): NetworkNode | undefined;
  reach(id: string): NetworkReach | undefined;
  nodes(): Iterable<NetworkNode>;
  reaches(selection?: ReachSelection): Iterable<NetworkReach>;
}
export interface NetworkWorkspace extends NetworkReader {
  putNode(node: NetworkNode): void;
  putReach(reach: NetworkReach): void;
  removeReach(id: string): void;
}
export function worldNetworkReader(world: World): NetworkReader {
  return {
    node: (id) => world.networkNodes?.[id],
    reach: (id) => world.networkReaches?.[id],
    nodes: () => Object.values(world.networkNodes ?? {}),
    *reaches(selection = {}) {
      for (const reach of Object.values(world.networkReaches ?? {}))
        if (
          (!selection.featureId || reach.featureId === selection.featureId) &&
          (!selection.nodeId || reach.start === selection.nodeId || reach.end === selection.nodeId)
        )
          yield reach;
    },
  };
}
