import { requireThat } from "../errors";
import type { SampleType } from "../workspaceResources";
import { KeyedHeap } from "../hpc/keyedHeap";
import { radixOrder } from "../hpc/radixOrder";
import { Band, type BandSchema, type BlockSource } from "./band";
import { BlockCache } from "./blockCache";
import type { BlockArray } from "./blockScratch";
import {
  blockCells,
  blockCount,
  blockShift,
  nodata as nodataBinding,
  type Lattice,
} from "./lattice";

// A module-local copy for per-cell membership tests (see band.ts).
const nodata = nodataBinding;

/** What a coverage needs of its cells: how many, how they block, and which are live. */
export type CoverageLayout = Pick<Lattice, "count" | "blockCount" | "blockLive" | "membership">;

/**
 * The layout of a sample set with no geometry of its own: a raster's or an adaptive field's
 * samples, or a topology's leaves. Every sample is a live cell; masks are bands, not layout.
 */
export function sampleLayout(count: number): CoverageLayout {
  const blocks = blockCount(count);
  return {
    count,
    blockCount: blocks,
    blockLive: (block) =>
      block < 0 || block >= blocks ? 0 : Math.min(blockCells, count - (block << blockShift)),
    membership: (cell) => (cell >= 0 && cell < count ? 1 : nodata),
  };
}

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
    readonly lattice: CoverageLayout,
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
   * Live cells in key order as a stream: each block's keys are radix-ordered into a run held
   * in scratch bands at the block's own position, and the runs merge through a heap of block
   * cursors. Ties keep ascending cell order. Resident state is one cursor per block; the
   * runs page with the cache like any band and are released when the stream ends.
   */
  *order(key: Band, descending = false): Generator<number> {
    const runCells = this.scratch("int32", "order:cells", key.length),
      runKeys = this.scratch("float64", "order:keys", key.length);
    try {
      const lengths = this.sortRuns(key, descending, runCells, runKeys),
        at = new Int32Array(lengths.length),
        heap = new KeyedHeap(descending ? "max" : "min");
      for (let block = 0; block < lengths.length; block++)
        if (lengths[block]) heap.push(block, runKeys.get(block << blockShift));
      for (let block = heap.pop(); block >= 0; block = heap.pop()) {
        const base = block << blockShift;
        yield base + runCells.get(base + at[block]++);
        if (at[block] < lengths[block]) heap.push(block, runKeys.get(base + at[block]));
      }
    } finally {
      this.release(runCells);
      this.release(runKeys);
    }
  }
  /** Radix-order each block's live keys into its run; returns the live count per block. */
  private sortRuns(key: Band, descending: boolean, runCells: Band, runKeys: Band) {
    const lattice = this.lattice,
      lengths = new Int32Array(blockCount(key.length));
    // One band block is pinned at a time; the block's keys and cells sort in locals.
    const write = (band: Band, block: number, fill: (values: BlockArray) => void) => {
      fill(band.block(block, true));
      band.unpin(block);
    };
    for (let block = 0; block < lengths.length; block++) {
      if (!this.blockLive(block, key.length)) continue;
      const start = block << blockShift,
        values = key.block(block),
        keys = new Float64Array(values.length),
        cells = new Int32Array(values.length);
      let live = 0;
      for (let n = 0; n < values.length; n++)
        if (lattice.membership(start + n) !== nodata) {
          keys[live] = values[n];
          cells[live++] = n;
        }
      key.unpin(block);
      if (!live) continue;
      const order = radixOrder(keys.subarray(0, live), descending);
      write(runCells, block, (run) => {
        for (let k = 0; k < live; k++) run[k] = cells[order[k]];
      });
      write(runKeys, block, (run) => {
        for (let k = 0; k < live; k++) run[k] = keys[order[k]];
      });
      lengths[block] = live;
    }
    return lengths;
  }
  /** A coverage sharing this one's lattice and bands copy-on-write. */
  snapshot(copies = new Map<Band, Band>()): Coverage {
    const copy = new Coverage(this.lattice, this.cache);
    for (const [name, band] of this.bands)
      if (!band.released) copies.set(band, copy.adopt(name, band.snapshot({}, ++copy.sequence)));
    return copy;
  }
  /** Snapshot an unnamed band (retained or scratch) into this coverage's accounting. */
  copyBand(band: Band) {
    const copy = band.snapshot({}, ++this.sequence);
    this.allocated.push(copy);
    return copy;
  }
}
