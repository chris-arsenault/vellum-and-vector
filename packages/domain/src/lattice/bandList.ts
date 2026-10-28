import type { SampleType } from "../workspaceResources";
import type { Band } from "./band";
import type { Coverage } from "./coverage";
import { blockCells, blockMask, blockShift } from "./lattice";

/**
 * An append-only list of samples whose length is unknown until it is built, stored as one
 * block-sized scratch band per chunk so it pages like any band. `finish` hands back one band
 * of the exact length, block for chunk.
 */
export class BandList {
  private chunks: Band[] = [];
  length = 0;
  constructor(
    private readonly coverage: Coverage,
    private readonly type: SampleType,
    private readonly name: string
  ) {}
  push(value: number) {
    const last = this.chunks[this.chunks.length - 1];
    if (!last || (this.length & blockMask) === 0 || (this.length & blockMask) >= last.length)
      this.grow(last);
    this.chunks[this.chunks.length - 1].set(this.length++ & blockMask, value);
  }
  /** The first chunk doubles up to a block, so a short list holds a short band. */
  private grow(last: Band | undefined) {
    const name = `${this.name}:${this.chunks.length}`;
    if (!last || this.length >= blockCells) {
      this.chunks.push(this.coverage.scratch(this.type, name, last ? blockCells : 256));
      return;
    }
    const next = this.coverage.scratch(this.type, name, Math.min(blockCells, last.length * 2));
    next.block(0, true).set(last.block(0));
    next.unpin(0);
    last.unpin(0);
    this.coverage.release(last);
    this.chunks[0] = next;
  }
  get(i: number) {
    return this.chunks[i >>> blockShift].get(i & blockMask);
  }
  /** The samples as one scratch band of the exact length; the list is emptied. */
  finish(): Band {
    const band = this.coverage.scratch(this.type, this.name, this.length);
    this.chunks.forEach((chunk, b) => {
      const to = band.block(b, true);
      to.set(chunk.block(0).subarray(0, to.length));
      chunk.unpin(0);
      band.unpin(b);
    });
    this.release();
    return band;
  }
  release() {
    for (const chunk of this.chunks) this.coverage.release(chunk);
    this.chunks = [];
    this.length = 0;
  }
}
