import type { MapRef, ReadOptions } from "@atlas/map";
import type { GenerationStatus } from "./generated";

/** Host lifecycle summaries, never numerical payloads. Map presentation uses MapReader. */
export interface StoredContext {
  reference: MapRef;
  name: string;
  parent: MapRef | null;
  profile: string;
  complete: boolean;
  head: boolean;
  saved: boolean;
  problem: string | null;
}
export interface OrphanContext {
  kind: string;
  id: string;
  reference: MapRef | null;
  problem: string | null;
}
export interface ContextInventory {
  maps: StoredContext[];
  jobs: GenerationStatus[];
  orphans: OrphanContext[];
  cleanup: string[];
  problems: string[];
}
export type DeleteContext =
  | { kind: "map"; id: string; descendants: boolean }
  | { kind: "job"; id: string }
  | { kind: "orphan"; orphan: OrphanContext }
  | { kind: "cleanup"; id: string };
export interface ContextManagement {
  list(options?: ReadOptions): Promise<ContextInventory>;
  delete(target: DeleteContext, options?: ReadOptions): Promise<ContextInventory>;
}
