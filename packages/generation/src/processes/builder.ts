import type { PhysicalContext } from "../world/context";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import type { AnswerKey } from "../coupling/answers";
import type { Pool } from "../coupling/flows";
import type { GroundProcess } from "./groundProcess";

/** A process with a long-lived body that works on the whole field. */
export interface BuilderEntry {
  id: string;
  /** What it does, in a sentence. */
  statement: string;
  /** Bands it cannot run without, which a selected step must have written earlier. */
  needs?: readonly PhysicalBufferName[];
  /** Bands other steps can rely on once it has run. */
  provides?: readonly PhysicalBufferName[];
  /** What it leaves that is not a band. */
  leaves?: readonly string[];
  /** Each `[from, to]` it moves material between; nothing, for what only reads the land. */
  moves?: readonly (readonly [Pool, Pool])[];
  /** What it asks of the world, by key. */
  asks?: readonly AnswerKey[];
  /** What must hold once it has run, or the run is wrong. */
  check?: (map: PhysicalField, context: PhysicalContext) => void;
  build: (map: PhysicalField, context: PhysicalContext) => void;
}
/** Adapts an existing algorithm to the sequence; needs/provides are scheduling prerequisites. */
export const builder = (entry: BuilderEntry): GroundProcess => ({
  needs: [],
  provides: [],
  moves: [],
  asks: [],
  settings: {},
  reads: [],
  writes: [],
  ...entry,
});
