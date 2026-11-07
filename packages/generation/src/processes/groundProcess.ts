import type { Band } from "@atlas/domain";
import type { PhysicalContext } from "../canonry/context";
import type { PhysicalBufferName, PhysicalField } from "../canonry/field";
import type { PhysicalProfile } from "../canonry/profile";
import type { AnswerKey } from "../coupling/answers";
import type { Pool } from "../coupling/flows";
import type { WearStage } from "../coupling/wearStage";
import type { Ground } from "../rock/ground";

/** The map a process is about to work on, as its settings need to read it. */
export interface ProcessReading {
  /** This map's cell size as a share of a world cell's. */
  readonly scale: number;
  /** How many passes this map runs in place of the world's history. */
  readonly passes: number;
}
/** A band as a process may see it when it only declared reading it. */
export type ReadOnlyBand = Pick<Band, "get" | "length">;
/** The field as a process declared it: what it reads, read only, and the mesh it lies on. */
export type DeclaredField<R extends PhysicalBufferName> = {
  readonly [K in R]: ReadOnlyBand;
} & Pick<PhysicalField, "mesh" | "EffectiveSeaLevel">;
/**
 * What a process is handed: only what it declared. Reading a band it did not declare will not compile,
 * and the ledger and stage are the only ways it can change anything.
 */
export interface ProcessWork<R extends PhysicalBufferName = never> {
  readonly field: DeclaredField<R>;
  readonly context: PhysicalContext;
  readonly settings: PhysicalProfile;
  readonly ground: Ground;
  /** How much work this pass stands for; rates are per unit of it. */
  readonly span: number;
  /** The answer to a declared question, as a band. */
  readonly ask: (key: AnswerKey) => Band;
  /** The stage of wear demands land in. */
  readonly wear: WearStage;
  /** Passes authority the view does not give, for routing and solvers private to a process. */
  readonly world: PhysicalField;
}
/**
 * Everything that shapes land, declared in one entry. How it finds its power is its own: streams route
 * water, ice follows its flux, slopes work between pairs of cells. What it needs and what it moves are
 * stated here, so the table of who affects whom comes from these and cannot go stale.
 */
export interface GroundProcess<R extends PhysicalBufferName = PhysicalBufferName> {
  readonly id: string;
  /** What it does, in a sentence. */
  readonly statement: string;
  /** What it reads from the field. */
  readonly reads: readonly R[];
  /** What it asks of the world, by key. */
  readonly asks: readonly AnswerKey[];
  /** Each `[from, to]` it moves material between. */
  readonly moves: readonly (readonly [Pool, Pool])[];
  /** Its own settings, as the profile holds them. */
  readonly settings: Readonly<Record<string, number>>;
  /** Its settings as they read on a map of another scale, where they differ from the world's. */
  readonly atScale?: (
    settings: PhysicalProfile,
    reading: ProcessReading
  ) => Partial<PhysicalProfile>;
  /** One pass of its work. */
  readonly run: (work: ProcessWork<R>) => void;
}
/** A process with its reads kept exact. Every process is declared through this. */
export const defineProcess = <const R extends PhysicalBufferName>(
  process: GroundProcess<R>
): GroundProcess => process as unknown as GroundProcess;
