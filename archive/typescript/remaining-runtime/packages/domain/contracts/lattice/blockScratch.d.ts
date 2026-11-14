import type { SampleType } from "../workspaceResources";
export type BlockArray =
  Float64Array | Float32Array | Int32Array | Uint32Array | Uint8Array | Int8Array;
export declare const blockConstructors: {
  readonly float64: Float64ArrayConstructor;
  readonly float32: Float32ArrayConstructor;
  readonly int32: Int32ArrayConstructor;
  readonly uint32: Uint32ArrayConstructor;
  readonly uint8: Uint8ArrayConstructor;
  readonly int8: Int8ArrayConstructor;
};
export declare function bytesPerSample(type: SampleType): number;
export declare function newBlock(type: SampleType, length: number): BlockArray;
/** Random access to one worker-owned file; the platform supplies the handle. */
export interface RandomAccessFile {
  read(bytes: Uint8Array, offset: number): number;
  write(bytes: Uint8Array, offset: number): number;
  flush(): void;
  close(): void;
}
/** Evicted dirty blocks of process and run bands live here as fixed slots per byte size.
 * The file is disposable working data, never a checkpoint. */
export declare class BlockScratch {
  private readonly file;
  private end;
  private readonly free;
  private closed;
  readonly stats: {
    reads: number;
    writes: number;
    readBytes: number;
    writtenBytes: number;
  };
  constructor(file: RandomAccessFile);
  /** A slot of `bytes`, reused from the free list of that size when one exists. */
  allocate(bytes: number): number;
  release(offset: number, bytes: number): void;
  write(offset: number, values: BlockArray): void;
  read(offset: number, into: BlockArray): void;
  flush(): void;
  close(): void;
  get isClosed(): boolean;
}
