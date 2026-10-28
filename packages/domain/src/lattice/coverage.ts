import { requireThat } from "../errors";
import type { SampleType } from "../workspaceResources";
import { KeyedHeap } from "../hpc/keyedHeap";
import { radixOrder } from "../hpc/radixOrder";
import { Band, type BandSchema, type BlockSource } from "./band";
import { BlockCache } from "./blockCache";
import type { BlockArray } from "./blockScratch";
import { blockCells, blockShift, nodata, type Lattice } from "./lattice";

/**
 * A lattice with a schema of typed bands: the world's numerical state. Bands are allocated
 * from the schema, iterated by block, snapshotted copy-on-write and ordered or reduced as
 * streams. Process-lifetime bands are released at process boundaries.
 */
export class Coverage {
  private readonly bands = new Map<string, Band>();
  private readonly allocated: Band[] = [];
  private sequence = 0;
  constructor(
    readonly lattice: Lattice,
    readonly cache: BlockCache = new BlockCache(Infinity)
  ) {}
  /** The band of a registered name. */
  band(name: string) {
    const band = this.bands.get(name);
    requireThat(band, "band_unknown", `No band ${name} in this coverage.`);
    return band;
  }
  has(name: string) {
    return this.bands.has(name);
  }
  names() {
    return [...this.bands.keys()];
  }
  /** Allocate a named band from its schema; the name is unique in the coverage. */
  allocate(schema: BandSchema, length = this.lattice.count, source: BlockSource | null = null) {
    requireThat(!this.bands.has(schema.name), "band_duplicate", `Band ${schema.name} exists.`);
    const band = new Band(schema, length, this.cache, source, ++this.sequence);
    this.bands.set(schema.name, band);
    this.allocated.push(band);
    return band;
  }
  /** An unnamed process-lifetime band for one pass's working values. */
  scratch(type: SampleType, name: string, length = this.lattice.count, initial = 0) {
    const band = new Band(
      { name, type, lifetime: "process", initial },
      length,
      this.cache,
      null,
      ++this.sequence
    );
    this.allocated.push(band);
    return band;
  }
  /** Adopt an existing band (a snapshot or a resident array) under a name. */
  adopt(name: string, band: Band) {
    requireThat(!this.bands.has(name), "band_duplicate", `Band ${name} exists.`);
    this.bands.set(name, band);
    this.allocated.push(band);
    return band;
  }
  release(band: Band) {
    band.release();
    if (this.bands.get(band.name) === band) this.bands.delete(band.name);
  }
  /** Marks the start of a process; `releaseProcess` frees process bands made since. */
  beginProcess() {
    return this.sequence + 1;
  }
  releaseProcess(from = 0) {
    for (const band of this.allocated)
      if (band.lifetime === "process" && band.sequence >= from && !band.released)
        this.release(band);
    this.prune();
  }
  /** Release bands no longer reachable, keeping those in `live`. */
  releaseUnused(candidates: Iterable<Band>, live: Iterable<Band>) {
    const keep = new Set(live);
    for (const band of candidates) if (!keep.has(band)) this.release(band);
    this.prune();
  }
  private prune() {
    let kept = 0;
    for (const band of this.allocated) if (!band.released) this.allocated[kept++] = band;
    this.allocated.length = kept;
  }
  /** Whether a block of cell-length bands holds any live cell. */
  private blockLive(block: number, length: number) {
    return length === this.lattice.count ? this.lattice.blockLive(block) > 0 : true;
  }
  /**
   * The local-pass primitive: pins the bands' blocks and hands the body native arrays with
   * the block's first cell id and sample count. Pass `write` for the bands the body writes.
   */
  forEachBlock(
    bands: Band[],
    visit: (arrays: BlockArray[], start: number, count: number, block: number) => void,
    write: Band[] = []
  ) {
    const length = bands[0]?.length ?? this.lattice.count,
      blocks = (length + blockCells - 1) >>> blockShift,
      written = new Set(write);
    for (let block = 0; block < blocks; block++) {
      if (!this.blockLive(block, length)) continue;
      const arrays = bands.map((band) => band.block(block, written.has(band)));
      try {
        visit(
          arrays,
          block << blockShift,
          Math.min(blockCells, length - (block << blockShift)),
          block
        );
      } finally {
        for (const band of bands) band.unpin(block);
      }
    }
  }
  /** Visit each live cell with its membership. */
  forEachCell(visit: (cell: number, membership: number) => void) {
    const lattice = this.lattice;
    for (let block = 0; block < lattice.blockCount; block++) {
      if (!lattice.blockLive(block)) continue;
      const start = block << blockShift,
        end = Math.min(lattice.count, start + blockCells);
      for (let cell = start; cell < end; cell++) {
        const membership = lattice.membership(cell);
        if (membership !== nodata) visit(cell, membership);
      }
    }
  }
  /** Fold a band over the live cells, streaming block by block. */
  reduce(
    band: Band,
    fold: (accumulator: number, value: number, cell: number) => number,
    seed: number
  ) {
    let result = seed;
    const lattice = this.lattice;
    this.forEachBlock([band], ([values], start, count) => {
      for (let n = 0; n < count; n++)
        if (lattice.membership(start + n) !== nodata) result = fold(result, values[n], start + n);
    });
    return result;
  }
  /**
   * Live cells in key order as a stream: each block's keys are radix-ordered, and the block
   * runs merge through a heap of block cursors. Ties keep ascending cell order. Resident
   * state is one cursor and one ordered run per block, never the whole permutation.
   */
  *order(key: Band, descending = false): Generator<number> {
    const lattice = this.lattice,
      runs: { start: number; order: Int32Array; keys: BlockArray; at: number }[] = [];
    this.forEachBlock([key], ([values], start, count, block) => {
      let live = 0;
      for (let n = 0; n < count; n++) if (lattice.membership(start + n) !== nodata) live++;
      if (!live) return;
      const keys = new Float64Array(live),
        cells = new Int32Array(live);
      for (let n = 0, k = 0; n < count; n++)
        if (lattice.membership(start + n) !== nodata) {
          keys[k] = values[n];
          cells[k++] = n;
        }
      const order = radixOrder(keys, descending);
      runs[block] = {
        start,
        order: Int32Array.from(order, (k) => cells[k]),
        keys: Float64Array.from(order, (k) => keys[k]),
        at: 0,
      };
    });
    const heap = new KeyedHeap(descending ? "max" : "min");
    for (let block = 0; block < runs.length; block++) {
      const run = runs[block];
      if (run) heap.push(block, run.keys[0]);
    }
    for (let block = heap.pop(); block >= 0; block = heap.pop()) {
      const run = runs[block];
      yield run.start + run.order[run.at++];
      if (run.at < run.order.length) heap.push(block, run.keys[run.at]);
    }
  }
  /** A coverage sharing this one's lattice and bands copy-on-write. */
  snapshot(): Coverage {
    const copy = new Coverage(this.lattice, this.cache);
    for (const [name, band] of this.bands)
      if (!band.released) copy.adopt(name, band.snapshot({}, ++copy.sequence));
    return copy;
  }
}
