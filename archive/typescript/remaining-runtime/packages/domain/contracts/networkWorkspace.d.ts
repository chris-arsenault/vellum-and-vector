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
export declare function worldNetworkReader(world: World): NetworkReader;
