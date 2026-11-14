import type { ChangeSet, DomainSnapshot } from "./operations";
export declare function updateNetworkTopology(
  snapshot: DomainSnapshot,
  changes: ChangeSet,
  ids: string[]
): void;
