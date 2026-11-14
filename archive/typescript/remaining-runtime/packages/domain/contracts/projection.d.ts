import type { ChangeSet, DomainSnapshot } from "./operations";
export declare function projectChanges(
  snapshot: DomainSnapshot,
  changes: ChangeSet
): DomainSnapshot;
