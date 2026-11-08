import type { Band } from "@atlas/domain";
import type { PhysicalContext } from "../world/context";
import type { MutablePhysicalBufferName, PhysicalBufferName, PhysicalField } from "../world/field";
import type { PhysicalProfile } from "../world/profile";
import type { AnswerKey } from "../coupling/answers";
import type { Pool } from "../coupling/flows";
import type { Stage } from "../coupling/stage";
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
export type DeclaredField<
  R extends PhysicalBufferName,
  W extends MutablePhysicalBufferName = never,
> = {
  readonly [K in R]: ReadOnlyBand;
} & { readonly [K in W]: Band } & Pick<PhysicalField, "mesh" | "EffectiveSeaLevel">;
/**
 * A narrow field view, shared ground operations and locally bound helpers. This is an authoring
 * interface, not a sandbox: prepare and whole-field builders can use the underlying field.
 */
export interface ProcessWork<
  R extends PhysicalBufferName = never,
  W extends MutablePhysicalBufferName = never,
  Operations = object,
> {
  readonly field: DeclaredField<R, W>;
  readonly context: PhysicalContext;
  readonly settings: PhysicalProfile;
  readonly ground: Ground;
  /** How much work this substep stands for; rates are per unit of it. */
  readonly span: number;
  /** Which of the step's substeps this is, from 0. */
  readonly substep: number;
  /** A shared fact. Consumers cannot mutate its cached values through this interface. */
  readonly ask: (key: AnswerKey) => ReadOnlyBand;
  /** The stage its demands land in, when the driver settles it. */
  readonly stage: Stage;
  /** What a process may do beyond its bands: scratch space, routing, the ledger's moves. */
  readonly tools: ProcessTools & Operations;
}
interface ProcessDeclaration {
  readonly id: string;
  /** What it does, in a sentence. */
  readonly statement: string;
  /** What it asks of the world, by key. */
  readonly asks: readonly AnswerKey[];
  /** Each `[from, to]` it moves material between. */
  readonly moves: readonly (readonly [Pool, Pool])[];
  /** Bands it cannot run without, which a selected step must have written earlier. */
  readonly needs?: readonly PhysicalBufferName[];
  /** Bands other steps can rely on once it has run. */
  readonly provides?: readonly PhysicalBufferName[];
  /** What it leaves that is not a band. */
  readonly leaves?: readonly string[];
  /** What must hold once it has run, or the run is wrong. */
  readonly check?: (map: PhysicalField, context: PhysicalContext) => void;
  /** Its own settings, as the profile holds them. */
  readonly settings: Readonly<Record<string, number>>;
  /**
   * How finely its step rule needs a span cut to stay stable: the driver runs that many substeps, each
   * a stage, and hands each its share of the span. One when it does not say.
   */
  readonly substeps?: (settings: PhysicalProfile, span: number) => number;
  /**
   * An immediate writer or solver that settles within its own run. It cannot join a simultaneous
   * stage, whose participants must leave their ground changes pending until joint settlement.
   */
  readonly settlesItself?: boolean;
  /** Its settings as they read on a map of another scale, where they differ from the world's. */
  readonly atScale?: (
    settings: PhysicalProfile,
    reading: ProcessReading
  ) => Partial<PhysicalProfile>;
}
/**
 * Everything that shapes land, declared in one entry. How it finds its power is its own: streams route
 * water, ice follows its flux, slopes work between pairs of cells. What it needs and what it moves are
 * stated beside the algorithm. The declarations describe intent; observations show actual effects.
 */
export interface GroundProcess<
  R extends PhysicalBufferName = PhysicalBufferName,
  W extends MutablePhysicalBufferName = MutablePhysicalBufferName,
> extends ProcessDeclaration {
  /** What it reads from the field. */
  readonly reads: readonly R[];
  /** The bands it writes for itself, such as a history. What it does to the ground is its `moves`. */
  readonly writes: readonly W[];
  /** One pass of its work on the view it declared. */
  readonly run?: (work: ProcessWork<R, W>) => void;
  /** Bind existing domain helpers once for this execution, beside their consumer. */
  readonly prepare?: (map: PhysicalField) => object;
  /**
   * One pass of work on the whole field, for a long-lived body that holds it directly, declared through
   * `builder`. Its scheduling prerequisites are explicit; its band reach is not inferred.
   */
  readonly build?: (map: PhysicalField, context: PhysicalContext) => void;
}
/** A process with its reads and writes kept exact. Every view-holding process is declared this way. */
export const defineProcess = <
  const R extends PhysicalBufferName,
  const W extends MutablePhysicalBufferName = never,
  Operations extends object = object,
>(
  process: ProcessDeclaration & {
    readonly reads: readonly R[];
    readonly writes?: readonly W[];
    readonly prepare?: (map: PhysicalField) => Operations;
    readonly run: (work: ProcessWork<R, W, Operations>) => void;
  }
): GroundProcess => ({ writes: [], ...process }) as unknown as GroundProcess;
