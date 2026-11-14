import type { SampleType } from "../workspaceResources";
import { Band, type BandSchema, type BlockSource } from "./band";
import { BlockCache } from "./blockCache";
import type { BlockArray } from "./blockScratch";
import { type ReadBand } from "./readBand";
import { type Lattice } from "./lattice";
/** What a coverage needs of its cells: how many, how they block, and which are live. */
export type CoverageLayout = Pick<Lattice, "count" | "blockCount" | "blockLive" | "membership">;
/**
 * The layout of a sample set with no geometry of its own: a raster's or an adaptive field's
 * samples, or a topology's leaves. Every sample is a live cell; masks are bands, not layout.
 */
export declare function sampleLayout(count: number): CoverageLayout;
/**
 * A lattice with a schema of typed bands: the world's numerical state. Bands are allocated
 * from the schema, iterated by block, snapshotted copy-on-write and ordered or reduced as
 * streams. Process-lifetime bands are released at process boundaries.
 */
export declare class Coverage {
  readonly lattice: CoverageLayout;
  readonly cache: BlockCache;
  private readonly bands;
  private readonly allocated;
  private sequence;
  constructor(lattice: CoverageLayout, cache?: BlockCache);
  /** The band of a registered name. */
  band(name: string): ReadBand;
  has(name: string): boolean;
  names(): string[];
  /** Stop named access from granting write authority; existing owner allocations stay private. */
  protect(names: Iterable<string>): void;
  /** Allocate a named band from its schema; the name is unique in the coverage. */
  allocate(schema: BandSchema, length?: number, source?: BlockSource | null): Band;
  /** An unnamed process-lifetime band for one pass's working values. */
  scratch(type: SampleType, name: string, length?: number, initial?: number): Band;
  /** Adopt an existing band (a snapshot or a resident array) under a name. */
  adopt(name: string, band: Band): Band;
  release(band: Band): void;
  /** Marks the start of a process; `releaseProcess` frees process bands made since. */
  beginProcess(): number;
  releaseProcess(from?: number): void;
  /** Release bands no longer reachable, keeping those in `live`. */
  releaseUnused(candidates: Iterable<Band>, live: Iterable<Band>): void;
  private prune;
  /** Whether a block of cell-length bands holds any live cell. */
  private blockLive;
  /**
   * The local-pass primitive: pins the bands' blocks and hands the body native arrays with
   * the block's first cell id and sample count. Pass `write` for the bands the body writes.
   */
  forEachBlock(
    bands: ReadBand[],
    visit: (arrays: BlockArray[], start: number, count: number, block: number) => void,
    write?: Band[]
  ): void;
  /** Visit each live cell with its membership. */
  forEachCell(visit: (cell: number, membership: number) => void): void;
  /** Fold a band over the live cells, streaming block by block. */
  reduce(
    band: ReadBand,
    fold: (accumulator: number, value: number, cell: number) => number,
    seed: number
  ): number;
  /**
   * Live cells in key order as a stream: each block's keys are radix-ordered into a run held
   * in scratch bands at the block's own position, and the runs merge through a heap of block
   * cursors. Ties keep ascending cell order. Resident state is one cursor per block; the
   * runs page with the cache like any band and are released when the stream ends.
   */
  order(key: ReadBand, descending?: boolean): Generator<number>;
  /** Radix-order each block's live keys into its run; returns the live count per block. */
  private sortRuns;
  /** A coverage sharing this one's lattice and bands copy-on-write. */
  snapshot(copies?: Map<ReadBand, Band>): Coverage;
  /** Snapshot an unnamed band (retained or scratch) into this coverage's accounting. */
  copyBand(band: ReadBand): Band;
}
