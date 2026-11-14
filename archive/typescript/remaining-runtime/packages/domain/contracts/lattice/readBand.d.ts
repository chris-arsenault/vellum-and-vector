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
export declare class ReadBandView implements ReadBand {
  #private;
  readonly schema: Readonly<BandSchema>;
  constructor(band: Band);
  get name(): string;
  get type(): import("..").SampleType;
  get length(): number;
  get blockCount(): number;
  get sequence(): number;
  get released(): boolean;
  get lifetime(): "run" | "process";
  get(cell: number): number;
  blockLength(block: number): number;
  block(block: number): BlockArray;
  unpin(): void;
  toArray(): BlockArray;
  snapshot(schema?: Partial<BandSchema>, sequence?: number): Band;
  [Symbol.iterator](): Generator<number, void, unknown>;
}
