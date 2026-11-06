import type { PhysicalContext } from "../canonry/context";
import type { PhysicalField } from "../canonry/field";
import type { PhysicalProfile } from "../canonry/profile";
import type { Ground } from "../rock/ground";

/** The map a process is about to work on, as its settings need to read it. */
export interface ProcessReading {
  /** This map's cell size as a share of a world cell's. */
  readonly scale: number;
  /** How many passes this map runs in place of the world's history. */
  readonly passes: number;
}
/** What a process is handed to work with: it asks the ground and never reads rock itself. */
export interface ProcessWork {
  readonly map: PhysicalField;
  readonly context: PhysicalContext;
  readonly settings: PhysicalProfile;
  readonly ground: Ground;
}
/**
 * A process that acts on the ground. How it finds its power is its own: streams route water, ice
 * follows its flux, slopes work between pairs of cells. What every process shares is how it meets the
 * ground, through modes and `Ground`, and how what it does lands, through the ledger. Its settings
 * live in a plain file of their own so the profile can assemble them without loading the process.
 */
export interface GroundProcess {
  readonly id: string;
  /** What it does, in a sentence. */
  readonly statement: string;
  /** Its own settings, as the profile holds them. */
  readonly settings: Readonly<Record<string, number>>;
  /** Its settings as they read on a map of another scale, where they differ from the world's. */
  readonly atScale?: (
    settings: PhysicalProfile,
    reading: ProcessReading
  ) => Partial<PhysicalProfile>;
  /** One pass of its work. */
  readonly run: (work: ProcessWork) => void;
}
