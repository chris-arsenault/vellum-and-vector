import { Band, type BandSchema } from "./band";
import type { BlockArray } from "./blockScratch";

/** Read algorithms accept working bands and live views without requiring write authority. */
export interface ReadBand extends Iterable<number> {
  readonly name: string;
  readonly type: BandSchema["type"];
  readonly schema: Readonly<BandSchema>;
  readonly length: number;
  readonly blockCount: number;
  readonly sequence: number;
  readonly released: boolean;
  readonly lifetime: BandSchema["lifetime"];
  get(cell: number): number;
  blockLength(block: number): number;
  block(block: number): BlockArray;
  unpin(block: number): void;
  toArray(): BlockArray;
  snapshot(schema?: Partial<BandSchema>, sequence?: number): Band;
}

/**
 * A live read capability. Bulk reads are detached copies, so retaining a block or a
 * snapshot never gives the reader a mutable alias to the owner's storage.
 */
export class ReadBandView implements ReadBand {
  readonly #band: Band;
  readonly schema: Readonly<BandSchema>;
  constructor(band: Band) {
    this.#band = band;
    this.schema = Object.freeze({ ...band.schema });
    Object.freeze(this);
  }
  get name() {
    return this.#band.name;
  }
  get type() {
    return this.#band.type;
  }
  get length() {
    return this.#band.length;
  }
  get blockCount() {
    return this.#band.blockCount;
  }
  get sequence() {
    return this.#band.sequence;
  }
  get released() {
    return this.#band.released;
  }
  get lifetime() {
    return this.#band.lifetime;
  }
  get(cell: number) {
    return this.#band.get(cell);
  }
  blockLength(block: number) {
    return this.#band.blockLength(block);
  }
  block(block: number): BlockArray {
    try {
      return this.#band.block(block).slice() as BlockArray;
    } finally {
      this.#band.unpin(block);
    }
  }
  unpin() {
    // A view's copied block never retains a cache pin.
  }
  toArray() {
    return this.#band.toArray();
  }
  snapshot(schema: Partial<BandSchema> = {}, sequence = this.sequence) {
    return this.#band.snapshot(schema, sequence);
  }
  *[Symbol.iterator]() {
    yield* this.#band;
  }
}
