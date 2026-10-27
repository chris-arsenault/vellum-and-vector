import type { DomainSnapshot, History } from "@atlas/domain";
import type { EpochHistory } from "@atlas/generation";

/** Released format-1 save shape, accepted only by the explicit local-map importer. */
export interface LegacySavedWorld {
  snapshot: DomainSnapshot;
  history: History[];
  undo: DomainSnapshot[];
  causes: Record<string, EpochHistory[]>;
}
