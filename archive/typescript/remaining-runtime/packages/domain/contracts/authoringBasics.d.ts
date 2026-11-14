import { type IntentRegistry, type IntentContext } from "./intent";
import type { ChangeSet, DomainSnapshot } from "./operations";
import type { Area } from "./model";
export declare function requireRelations(
  snapshot: DomainSnapshot,
  ids: string[],
  additional?: string[]
): void;
export declare function requireIdentity(snapshot: DomainSnapshot, id: string, kind: string): void;
export declare function invalidateFacts(
  changes: ChangeSet,
  context: IntentContext,
  snapshot: DomainSnapshot,
  facts: string[],
  footprint?: import("geojson").Geometry
): void;
export declare function upsertArea(changes: ChangeSet, value: Area): void;
export declare function registerBasicIntents(registry: IntentRegistry): void;
