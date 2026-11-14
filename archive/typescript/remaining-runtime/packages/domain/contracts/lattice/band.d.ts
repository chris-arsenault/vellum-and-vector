import type { SampleType } from "../workspaceResources";
import type { BlockCache, BlockOwner } from "./blockCache";
import { type BlockArray } from "./blockScratch";
import type { ReadBand } from "./readBand";
export interface BandSchema {
  name: string;
  type: SampleType;
  units?: string;
  /** Value of a sample that was never written. */
  initial?: number;
  lifetime: "run" | "process";
  /** Carried across epochs rather than recomputed. */
  retained?: boolean;
  /** Written to the committed resource at publication. */
  published?: boolean;
  /** A committed input: shared by copies rather than duplicated. */
  immutable?: boolean;
}
/** Reads a block of a committed resource into memory. */
export type BlockSource = (block: number, into: BlockArray) => void;
/**
 * A typed value per cell stored as blocks. A block is a native typed array when resident and
 * `null` when evicted; a read is two array indexings. A block evicted with unsaved writes
 * spills to the scratch file; a clean one reloads from its spill slot, from the committed
 * source, or as the initial value. A snapshot copies only the blocks that are dirty in
 * memory and shares spill slots, which are then never overwritten.
 */
export declare class Band implements BlockOwner {
  readonly length: number;
  private readonly cache;
  private readonly source;
  readonly sequence: number;
  readonly schema: Readonly<BandSchema>;
  readonly blockCount: number;
  private readonly blocks;
  private readonly dirty;
  /** Scratch offset of the spilled block, or -1. */
  private readonly spill;
  /** The spill slot is shared with a snapshot: read-only; a dirty eviction takes a new slot. */
  private readonly spillShared;
  private readonly initial;
  released: boolean;
  lifetime: "run" | "process";
  constructor(
    schema: BandSchema,
    length: number,
    cache: BlockCache,
    source?: BlockSource | null,
    sequence?: number
  );
  get type(): SampleType;
  /** Promote a process band that the working state carries into later processes. */
  retain(): void;
  get name(): string;
  /** Samples in block `b`. */
  blockLength(b: number): number;
  private blockBytes;
  get(i: number): number;
  set(i: number, value: number): void;
  add(i: number, delta: number): void;
  /** A working native block, pinned until `unpin`; immutable inputs return an independent copy. */
  block(b: number, write?: boolean): BlockArray;
  /** A committed input is shared by every reader; it is never written in place. */
  private markDirty;
  unpin(b: number): void;
  fill(value: number, start?: number, end?: number): this;
  private load;
  /** Called by the cache: drop the block, spilling it first when it holds unsaved writes. */
  evict(b: number): void;
  /**
   * A band that reads what this one reads now and diverges on either side's next write. A
   * snapshot of a committed input is a working copy: writable, reloading untouched blocks
   * from the input's source, so it lives no longer than the input stays open.
   */
  snapshot(schema?: Partial<BandSchema>, sequence?: number): Band;
  /** Replace the band's contents with another band of the same length. */
  copyFrom(other: ReadBand): void;
  release(): void;
  private check;
  /** The band's values in order; for tests and small bands. */
  [Symbol.iterator](): Generator<number, void, unknown>;
  toArray(): BlockArray;
  /** A resident band over an existing array (no copy); its blocks are views and never leave. */
  static over(values: BlockArray, schema: BandSchema, cache: BlockCache): Band;
}
