import type { PhysicalContext } from "../canonry/context";
import type { PhysicalField } from "../canonry/field";
import type { PhysicalProfile } from "../canonry/profile";
import type { Ground } from "../rock/ground";

/** The map a process is about to work on, as its settings need to read it. */
export interface WearReading {
  /** This map's cell size as a share of a world cell's. */
  readonly scale: number;
  /** How many passes of wear this map runs in place of the world's history. */
  readonly passes: number;
}
/** What a process is given to work with: it asks the ground and never reads rock itself. */
export interface WearWork {
  readonly map: PhysicalField;
  readonly context: PhysicalContext;
  readonly settings: PhysicalProfile;
  readonly ground: Ground;
}
/**
 * A process that wears the land down. It says what it can do; the ground says how that lands on the
 * rock there; `wearLedger` keeps the books.
 */
export interface WearProcess {
  readonly id: string;
  /** What it does, in a sentence. */
  readonly statement: string;
  /** Its settings as they read on a map of another scale, where they differ from the world's. */
  readonly atScale?: (settings: PhysicalProfile, reading: WearReading) => Partial<PhysicalProfile>;
  /** One pass of its work. */
  readonly wear: (work: WearWork) => void;
}
