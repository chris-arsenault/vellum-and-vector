import { DomainError, requireThat } from "../errors";
import type { SampleType } from "../workspaceResources";

export type BlockArray =
  Float64Array | Float32Array | Int32Array | Uint32Array | Uint8Array | Int8Array;
export const blockConstructors = {
  float64: Float64Array,
  float32: Float32Array,
  int32: Int32Array,
  uint32: Uint32Array,
  uint8: Uint8Array,
  int8: Int8Array,
} as const;
export function bytesPerSample(type: SampleType) {
  return blockConstructors[type].BYTES_PER_ELEMENT;
}
export function newBlock(type: SampleType, length: number): BlockArray {
  return new blockConstructors[type](length);
}

/** Random access to one worker-owned file; the platform supplies the handle. */
export interface RandomAccessFile {
  read(bytes: Uint8Array, offset: number): number;
  write(bytes: Uint8Array, offset: number): number;
  flush(): void;
  close(): void;
}
/** File APIs may complete only part of a request; a zero-byte transfer cannot advance it. */
function transfer(
  operation: "read" | "write",
  bytes: Uint8Array,
  offset: number,
  move: (remaining: Uint8Array, at: number) => number
) {
  let completed = 0;
  try {
    while (completed < bytes.byteLength) {
      const count = move(bytes.subarray(completed), offset + completed);
      requireThat(
        Number.isSafeInteger(count) && count > 0 && count <= bytes.byteLength - completed,
        `block_${operation}`,
        `Scratch ${operation} stopped after ${completed} of ${bytes.byteLength} bytes at ${offset}.`
      );
      completed += count;
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      `block_${operation}`,
      `Scratch ${operation} failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return completed;
}
/** Evicted dirty blocks of process and run bands live here as fixed slots per byte size.
 * The file is disposable working data, never a checkpoint. */
export class BlockScratch {
  private end = 0;
  private readonly free = new Map<number, number[]>();
  private closed = false;
  readonly stats = { reads: 0, writes: 0, readBytes: 0, writtenBytes: 0 };
  constructor(private readonly file: RandomAccessFile) {}
  /** A slot of `bytes`, reused from the free list of that size when one exists. */
  allocate(bytes: number) {
    requireThat(!this.closed, "block_closed", "The block scratch is closed.");
    const list = this.free.get(bytes);
    if (list?.length) return list.pop()!;
    const offset = this.end;
    this.end += bytes;
    return offset;
  }
  release(offset: number, bytes: number) {
    if (this.closed) return;
    let list = this.free.get(bytes);
    if (!list) this.free.set(bytes, (list = []));
    list.push(offset);
  }
  write(offset: number, values: BlockArray) {
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    this.stats.writes++;
    this.stats.writtenBytes += transfer("write", bytes, offset, (part, at) =>
      this.file.write(part, at)
    );
  }
  read(offset: number, into: BlockArray) {
    const bytes = new Uint8Array(into.buffer, into.byteOffset, into.byteLength);
    this.stats.reads++;
    this.stats.readBytes += transfer("read", bytes, offset, (part, at) => this.file.read(part, at));
  }
  flush() {
    this.file.flush();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.file.close();
  }
  get isClosed() {
    return this.closed;
  }
}
