import { requireThat } from "../errors";
import type { SampleType } from "../workspaceResources";
import type { BlockCache, BlockOwner } from "./blockCache";
import { bytesPerSample, newBlock, type BlockArray } from "./blockScratch";
import { blockCells, blockCount, blockMask, blockShift } from "./lattice";

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
export class Band implements BlockOwner {
  readonly blockCount: number;
  private readonly blocks: (BlockArray | null)[];
  private readonly dirty: Uint8Array;
  /** Scratch offset of the spilled block, or -1. */
  private readonly spill: Float64Array;
  /** The spill slot is shared with a snapshot: read-only; a dirty eviction takes a new slot. */
  private readonly spillShared: Uint8Array;
  private readonly initial: number;
  released = false;
  lifetime: "run" | "process";
  constructor(
    readonly schema: BandSchema,
    readonly length: number,
    private readonly cache: BlockCache,
    private readonly source: BlockSource | null = null,
    readonly sequence = 0
  ) {
    requireThat(
      Number.isSafeInteger(length) && length >= 0,
      "band_length",
      "A band needs a nonnegative length."
    );
    this.blockCount = blockCount(length);
    this.blocks = new Array<BlockArray | null>(this.blockCount).fill(null);
    this.dirty = new Uint8Array(this.blockCount);
    this.spill = new Float64Array(this.blockCount).fill(-1);
    this.spillShared = new Uint8Array(this.blockCount);
    this.initial = schema.initial ?? 0;
    this.lifetime = schema.lifetime;
  }
  get type() {
    return this.schema.type;
  }
  /** Promote a process band that the working state carries into later processes. */
  retain() {
    this.lifetime = "run";
  }
  get name() {
    return this.schema.name;
  }
  /** Samples in block `b`. */
  blockLength(b: number) {
    return Math.min(blockCells, this.length - (b << blockShift));
  }
  private blockBytes(b: number) {
    return this.blockLength(b) * bytesPerSample(this.schema.type);
  }
  get(i: number): number {
    const b = this.blocks[i >>> blockShift];
    return (b === null ? this.load(i >>> blockShift) : b)[i & blockMask];
  }
  set(i: number, value: number) {
    const block = i >>> blockShift,
      b = this.blocks[block],
      values = b === null ? this.load(block) : b;
    if (this.dirty[block] === 0) this.markDirty(block);
    values[i & blockMask] = value;
  }
  add(i: number, delta: number) {
    const block = i >>> blockShift,
      b = this.blocks[block],
      values = b === null ? this.load(block) : b;
    if (this.dirty[block] === 0) this.markDirty(block);
    values[i & blockMask] += delta;
  }
  /** The native block, pinned until `unpin`; pass `write` when the body writes it. */
  block(b: number, write = false): BlockArray {
    const values = this.blocks[b] ?? this.load(b);
    if (write && this.dirty[b] === 0) this.markDirty(b);
    this.cache.pin(this, b);
    return values;
  }
  /** A committed input is shared by every reader; it is never written in place. */
  private markDirty(b: number) {
    requireThat(
      !this.schema.immutable,
      "immutable_band",
      `Immutable band ${this.schema.name} needs a separate working output.`
    );
    this.dirty[b] = 1;
  }
  unpin(b: number) {
    this.cache.unpin(this, b);
  }
  fill(value: number, start = 0, end = this.length) {
    requireThat(start >= 0 && end <= this.length && start <= end, "band_range", "Fill in range.");
    for (let b = start >>> blockShift; b < this.blockCount && b << blockShift < end; b++) {
      const base = b << blockShift,
        values = this.block(b, true);
      values.fill(value, Math.max(0, start - base), Math.min(values.length, end - base));
      this.unpin(b);
    }
    return this;
  }
  private load(b: number): BlockArray {
    this.check();
    const values = newBlock(this.schema.type, this.blockLength(b));
    if (this.spill[b] >= 0) this.cache.scratch!.read(this.spill[b], values);
    else if (this.source) this.source(b, values);
    else if (this.initial !== 0) values.fill(this.initial);
    this.blocks[b] = values;
    this.dirty[b] = 0;
    this.cache.admit(this, b, this.blockBytes(b));
    return values;
  }
  /** Called by the cache: drop the block, spilling it first when it holds unsaved writes. */
  evict(b: number) {
    const values = this.blocks[b];
    if (values === null) return;
    if (this.dirty[b] === 1) {
      const scratch = this.cache.scratch;
      requireThat(scratch, "block_scratch", "Evicting a dirty block needs a scratch file.");
      if (this.spill[b] < 0 || this.spillShared[b] === 1) {
        this.spill[b] = scratch.allocate(this.blockBytes(b));
        this.spillShared[b] = 0;
      }
      scratch.write(this.spill[b], values);
    }
    this.blocks[b] = null;
    this.dirty[b] = 0;
  }
  /**
   * A band that reads what this one reads now and diverges on either side's next write. A
   * snapshot of a committed input is a working copy: writable, reloading untouched blocks
   * from the input's source, so it lives no longer than the input stays open.
   */
  snapshot(schema: Partial<BandSchema> = {}, sequence = this.sequence): Band {
    this.check();
    const copy = new Band(
      { ...this.schema, immutable: false, ...schema },
      this.length,
      this.cache,
      this.source,
      sequence
    );
    for (let b = 0; b < this.blockCount; b++) {
      const values = this.blocks[b];
      // A resident block with nowhere else to reload from (unsaved writes, or an array a
      // band was made over) is copied; anything else is shared through its spill or source.
      if (values !== null && (this.dirty[b] === 1 || (this.spill[b] < 0 && !this.source))) {
        copy.blocks[b] = values.slice() as BlockArray;
        copy.dirty[b] = 1;
        this.cache.admit(copy, b, this.blockBytes(b));
      } else if (this.spill[b] >= 0) {
        copy.spill[b] = this.spill[b];
        copy.spillShared[b] = 1;
        this.spillShared[b] = 1;
      }
    }
    return copy;
  }
  /** Replace the band's contents with another band of the same length. */
  copyFrom(other: Band) {
    requireThat(other.length === this.length, "band_length", "Copy bands of equal length.");
    for (let b = 0; b < this.blockCount; b++) {
      const from = other.block(b),
        to = this.block(b, true);
      to.set(from);
      other.unpin(b);
      this.unpin(b);
    }
  }
  release() {
    if (this.released) return;
    this.released = true;
    this.cache.forget(this);
    const scratch = this.cache.scratch;
    for (let b = 0; b < this.blockCount; b++) {
      if (scratch && this.spill[b] >= 0 && this.spillShared[b] === 0)
        scratch.release(this.spill[b], this.blockBytes(b));
      this.blocks[b] = null;
      this.spill[b] = -1;
    }
  }
  private check() {
    requireThat(!this.released, "band_released", `Band ${this.schema.name} has been released.`);
  }
  /** The band's values in order; for tests and small bands. */
  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) yield this.get(i);
  }
  toArray(): BlockArray {
    const result = newBlock(this.schema.type, this.length);
    for (let b = 0; b < this.blockCount; b++) {
      result.set(this.block(b), b << blockShift);
      this.unpin(b);
    }
    return result;
  }
  /** A resident band over an existing array (no copy); its blocks are views and never leave. */
  static over(values: BlockArray, schema: BandSchema, cache: BlockCache): Band {
    const band = new Band(schema, values.length, cache);
    for (let b = 0; b < band.blockCount; b++) {
      const start = b << blockShift;
      band.blocks[b] = values.subarray(start, start + band.blockLength(b)) as BlockArray;
      cache.admit(band, b, 0);
    }
    return band;
  }
}
