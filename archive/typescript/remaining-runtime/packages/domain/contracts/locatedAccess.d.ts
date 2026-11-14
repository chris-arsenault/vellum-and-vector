import type { Area } from "./model";
import type { IntentContext } from "./intent";
import type { ChangeSet, DomainSnapshot } from "./operations";
export declare function addLocatedAccess(
  changes: ChangeSet,
  context: IntentContext,
  snapshot: DomainSnapshot,
  area: Area
): void;
