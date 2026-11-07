import type { Band } from "@atlas/domain";
import type { PhysicalContext } from "../world/context";
import type { PhysicalBufferName, PhysicalField } from "../world/field";
import type { PhysicalProfile } from "../world/profile";
import type { AnswerKey } from "../coupling/answers";
import type { Pool } from "../coupling/flows";
import type { WearStage } from "../coupling/wearStage";
import type { Ground } from "../rock/ground";
import type { ProcessTools } from "./processTools";

/** The map a process is about to work on, as its settings need to read it. */
export interface ProcessReading {
  /** This map's cell size as a share of a world cell's. */
  readonly scale: number;
  /** How many passes this map runs in place of the world's history. */
  readonly passes: number;
}
/** A band as a process may see it when it only declared reading it. */
export type ReadOnlyBand = Pick<Band, "get" | "length">;
/** The field as a process declared it: read only what it reads, and writable what it keeps itself. */
export type DeclaredField<R extends PhysicalBufferName, W extends PhysicalBufferName = never> = {
  readonly [K in R]: ReadOnlyBand;
} & { readonly [K in W]: Band } & Pick<PhysicalField, "mesh" | "EffectiveSeaLevel">;
/**
 * What a process is handed: only what it declared. Reading or writing a band it did not declare will
 * not compile. The ground changes through the wear stage and the ledger's own moves in its tools, and
 * there is no way from here to the whole field.
 */
export interface ProcessWork<
  R extends PhysicalBufferName = never,
  W extends PhysicalBufferName = never,
> {
  readonly field: DeclaredField<R, W>;
  readonly context: PhysicalContext;
  readonly settings: PhysicalProfile;
  readonly ground: Ground;
  /** How much work this pass stands for; rates are per unit of it. */
  readonly span: number;
  /** The answer to a declared question, as a band. */
  readonly ask: (key: AnswerKey) => Band;
  /** The stage of wear demands land in. */
  readonly wear: WearStage;
  /** What a process may do beyond its bands: scratch space, routing, the ledger's moves. */
  readonly tools: ProcessTools;
}
interface ProcessDeclaration {
  readonly id: string;
  /** What it does, in a sentence. */
  readonly statement: string;
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
}
/**
 * Everything that shapes land, declared in one entry. How it finds its power is its own: streams route
 * water, ice follows its flux, slopes work between pairs of cells. What it needs and what it moves are
 * stated here, so the table of who affects whom comes from these and cannot go stale.
 */
export interface GroundProcess<
  R extends PhysicalBufferName = PhysicalBufferName,
  W extends PhysicalBufferName = PhysicalBufferName,
> extends ProcessDeclaration {
  /** What it reads from the field. */
  readonly reads: readonly R[];
  /** The bands it writes for itself, such as a history. What it does to the ground is its `moves`. */
  readonly writes: readonly W[];
  /** One pass of its work on the view it declared. */
  readonly run?: (work: ProcessWork<R, W>) => void;
  /**
   * One pass of work on the whole field, for a long-lived body that holds it directly. Its `reads` and
   * `writes` are what the code reaches, which the architecture check derives and holds it to.
   */
  readonly build?: (map: PhysicalField, context: PhysicalContext) => void;
}
/** A process with its reads and writes kept exact. Every view-holding process is declared this way. */
export const defineProcess = <
  const R extends PhysicalBufferName,
  const W extends PhysicalBufferName = never,
>(
  process: ProcessDeclaration & {
    readonly reads: readonly R[];
    readonly writes?: readonly W[];
    readonly run: (work: ProcessWork<R, W>) => void;
  }
): GroundProcess => ({ writes: [], ...process }) as unknown as GroundProcess;
