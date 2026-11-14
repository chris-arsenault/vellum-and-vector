import type { World } from "./model";
import type { DomainSnapshot, ChangeSet } from "./operations";
export declare function reconcileFeatureContracts(
  snapshot: DomainSnapshot,
  candidate: World,
  changes: ChangeSet,
  features: string[],
  ownerArea: string
): void;
