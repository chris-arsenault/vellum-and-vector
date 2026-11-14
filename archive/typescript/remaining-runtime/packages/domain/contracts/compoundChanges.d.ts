import type { ChangeSet, DomainSnapshot } from "./operations";
import { type IntentContext } from "./intent";
export declare function combineChanges(
  context: IntentContext,
  source: DomainSnapshot,
  parts: ChangeSet[]
): ChangeSet;
export declare function stagedSnapshot(source: DomainSnapshot, changes: ChangeSet): DomainSnapshot;
