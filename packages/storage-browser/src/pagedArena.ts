import {
  readNumericalBlock,
  requireThat,
  writeNumericalBlock,
  type NumericalAllocation,
  type NumericalAllocator,
  type NumericalVector,
  type SampleArray,
  type SampleType,
} from "@atlas/domain";
import { ByteCache } from "./byteCache";
import { NumericalView, numericalViewStorage, numericalStorage } from "./numericalView";
import { sampleConstructors, type VectorStorage } from "./vectorStorage";
import { transferFile } from "./fileTransfer";

export interface RandomAccessFile {
  read(bytes: Uint8Array, offset: number): number;
  write(bytes: Uint8Array, offset: number): number;
  flush(): void;
  close(): void;
}
interface Page {
  owner: PagedStorage;
  index: number;
  values: SampleArray;
  dirty: boolean;
}
interface FreeRange {
  offset: number;
  bytes: number;
}
export const numericalPageSamples = 16_384;
export const numericalWorkingCacheBytes = 64 * 1024 * 1024;
export const numericalResidentBytes = 512 * 1024 * 1024;

/** A tracked native allocation: the algorithm indexes a plain typed array; the arena only
 * accounts for its lifetime and resident bytes. */
interface NativeAllocation {
  id: number;
  bytes: number;
  lifetime: NumericalAllocation["lifetime"];
  released: boolean;
}
export type NativeVector = SampleArray & {
  retain(): void;
  immutable?: boolean;
};
function allocationBytes(input: NumericalAllocation) {
  requireThat(
    Number.isSafeInteger(input.length) && input.length >= 0,
    "numerical_length",
    "A numerical allocation needs a nonnegative sample count."
  );
  const bytes =
    Math.ceil((input.length * sampleConstructors[input.type].BYTES_PER_ELEMENT) / 8) * 8;
  requireThat(
    Number.isSafeInteger(bytes),
    "numerical_length",
    "Numerical addresses must be exact integers."
  );
  return bytes;
}

/** One worker-owned scratch file and a shared page cache, independent of world coverage.
 * Allocations inside the resident budget are native typed arrays with no indirection on the
 * sample path; paging is the overflow path, never the default. */
export class PagedArena implements NumericalAllocator {
  private cache: ByteCache<string, Page>;
  private allocations = new Map<number, PagedStorage | NativeAllocation>();
  private natives = new WeakMap<object, NativeAllocation>();
  private resident = 0;
  private free: FreeRange[] = [];
  private end = 0;
  private sequence = 0;
  private closed = false;
  readonly stats = {
    reads: 0,
    writes: 0,
    readBytes: 0,
    writtenBytes: 0,
    peakDecodedBytes: 0,
    peakResidentBytes: 0,
  };
  constructor(
    private file: RandomAccessFile,
    cacheBytes = numericalWorkingCacheBytes,
    readonly pageSamples = numericalPageSamples,
    readonly residentBytes = 0
  ) {
    requireThat(
      Number.isSafeInteger(pageSamples) && pageSamples > 0,
      "numerical_page",
      "Page size must be a positive sample count."
    );
    this.cache = new ByteCache(cacheBytes, (page) => this.flushPage(page));
  }
  allocate(input: NumericalAllocation): NumericalVector {
    requireThat(!this.closed, "numerical_closed", "The numerical workspace is closed.");
    const bytes = allocationBytes(input);
    if (this.resident + bytes > this.residentBytes)
      return new NumericalView(this.createStorage(input)).view;
    const values = new sampleConstructors[input.type](input.length) as NativeVector;
    const allocation: NativeAllocation = {
      id: ++this.sequence,
      bytes,
      lifetime: input.lifetime,
      released: false,
    };
    this.resident += bytes;
    this.stats.peakResidentBytes = Math.max(this.stats.peakResidentBytes, this.resident);
    this.allocations.set(allocation.id, allocation);
    this.natives.set(values, allocation);
    Object.defineProperty(values, "retain", {
      value: () => {
        allocation.lifetime = "run";
      },
    });
    return values;
  }
  /** Whether this arena hands the vector out as a native typed array it accounts for. */
  isNative(vector: NumericalVector) {
    return this.natives.has(vector);
  }
  private releaseNative(allocation: NativeAllocation) {
    if (allocation.released) return;
    allocation.released = true;
    this.allocations.delete(allocation.id);
    this.resident -= allocation.bytes;
  }
  createStorage(input: NumericalAllocation): PagedStorage {
    requireThat(!this.closed, "numerical_closed", "The numerical workspace is closed.");
    const bytes = allocationBytes(input);
    const available = this.free.findIndex((range) => range.bytes >= bytes),
      range = available < 0 ? { offset: this.end, bytes } : this.free.splice(available, 1)[0];
    if (available < 0) this.end += bytes;
    else if (range.bytes > bytes)
      this.free.push({ offset: range.offset + bytes, bytes: range.bytes - bytes });
    requireThat(
      Number.isSafeInteger(this.end),
      "numerical_length",
      "Numerical addresses must be exact integers."
    );
    const storage = new PagedStorage(this, ++this.sequence, range.offset, bytes, input);
    this.allocations.set(storage.id, storage);
    return storage;
  }
  read(vector: NumericalVector, start: number, count: number) {
    if (ArrayBuffer.isView(vector)) return readNumericalBlock(vector, start, count);
    const view = numericalViewStorage(vector);
    requireThat(
      start >= 0 && count >= 0 && start + count <= view.length,
      "numerical_range",
      "Read stays inside its numerical view."
    );
    return view.storage.readBlock(view.offset + start, count);
  }
  write(vector: NumericalVector, start: number, values: SampleArray) {
    if (ArrayBuffer.isView(vector)) {
      writeNumericalBlock(vector, start, values);
      return;
    }
    const view = numericalViewStorage(vector);
    requireThat(
      start >= 0 && start + values.length <= view.length,
      "numerical_range",
      "Write stays inside its numerical view."
    );
    view.storage.writeBlock(view.offset + start, values);
  }
  release(vector: NumericalVector) {
    const native = this.natives.get(vector);
    if (native) this.releaseNative(native);
    else if (!ArrayBuffer.isView(vector)) numericalViewStorage(vector).storage.release();
  }
  private owned(vector: NumericalVector): PagedStorage | NativeAllocation | undefined {
    const native = this.natives.get(vector);
    if (native) return native;
    const storage = numericalStorage(vector);
    return storage instanceof PagedStorage && storage.arena === this ? storage : undefined;
  }
  releaseUnused(candidates: Iterable<NumericalVector>, live: Iterable<NumericalVector>) {
    const retained = new Set<object>();
    for (const vector of live) {
      const owner = this.owned(vector);
      if (owner) retained.add(owner);
    }
    for (const vector of candidates) {
      const owner = this.owned(vector);
      if (!owner || retained.has(owner)) continue;
      if (owner instanceof PagedStorage) owner.release();
      else this.releaseNative(owner);
    }
  }
  retain(vector: NumericalVector) {
    // Untracked typed arrays (copies made by slice) are owned by the garbage collector.
    if (ArrayBuffer.isView(vector) && !this.natives.has(vector)) return;
    const owner = this.owned(vector);
    requireThat(owner, "numerical_owner", "Retain a vector in its owning workspace.");
    owner.lifetime = "run";
  }
  beginProcess() {
    return this.sequence + 1;
  }
  releaseProcess(from = 0) {
    for (const allocation of [...this.allocations.values()])
      if (allocation.lifetime === "process" && allocation.id >= from) {
        if (allocation instanceof PagedStorage) allocation.release();
        else this.releaseNative(allocation);
      }
  }
  page(owner: PagedStorage, index: number) {
    owner.check();
    if (owner.activePage?.index === index) return { page: owner.activePage, retained: true };
    const key = `${owner.id}:${index}`,
      previous = this.cache.get(key);
    if (previous) {
      owner.activePage = previous;
      return { page: previous, retained: true };
    }
    const values = new sampleConstructors[owner.type](
      Math.min(this.pageSamples, owner.length - index * this.pageSamples)
    );
    if (owner.written.has(index)) {
      const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
      const count = transferFile(
        "read",
        bytes,
        owner.offset + index * this.pageSamples * values.BYTES_PER_ELEMENT,
        (part, at) => this.file.read(part, at)
      );
      this.stats.reads++;
      this.stats.readBytes += count;
    } else if (owner.initial !== 0 || Object.is(owner.initial, -0)) values.fill(owner.initial);
    const page: Page = { owner, index, values, dirty: false },
      retained = this.cache.set(key, page, values.byteLength);
    if (retained) owner.activePage = page;
    this.stats.peakDecodedBytes = Math.max(this.stats.peakDecodedBytes, this.cache.bytes);
    return { page, retained };
  }
  dirty(page: Page, retained: boolean) {
    page.dirty = true;
    if (!retained) this.flushPage(page);
  }
  private flushPage(page: Page) {
    if (page.owner.activePage === page) page.owner.activePage = undefined;
    if (!page.dirty || page.owner.released || this.closed) return;
    const values = page.values,
      bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    const count = transferFile(
      "write",
      bytes,
      page.owner.offset + page.index * this.pageSamples * values.BYTES_PER_ELEMENT,
      (part, at) => this.file.write(part, at)
    );
    page.owner.written.add(page.index);
    page.dirty = false;
    this.stats.writes++;
    this.stats.writtenBytes += count;
  }
  forget(owner: PagedStorage) {
    this.cache.deleteWhere((_, page) => page.owner === owner);
  }
  freeStorage(owner: PagedStorage) {
    this.allocations.delete(owner.id);
    this.forget(owner);
    this.free.push({ offset: owner.offset, bytes: owner.bytes });
    this.free.sort((a, b) => a.offset - b.offset);
    const merged: FreeRange[] = [];
    for (const range of this.free) {
      const last = merged.at(-1);
      if (last && last.offset + last.bytes === range.offset) last.bytes += range.bytes;
      else merged.push({ ...range });
    }
    this.free = merged;
  }
  flush() {
    this.cache.clear();
    this.file.flush();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.cache.clear();
    this.allocations.clear();
    this.resident = 0;
    this.file.close();
  }
  isClosed() {
    return this.closed;
  }
}
class PagedStorage implements VectorStorage {
  // Only a cached page may be held here; eviction clears this pointer before releasing bytes.
  activePage?: Page;
  readonly written = new Set<number>();
  readonly type: SampleType;
  readonly length: number;
  lifetime: NumericalAllocation["lifetime"];
  initial = 0;
  released = false;
  constructor(
    readonly arena: PagedArena,
    readonly id: number,
    readonly offset: number,
    readonly bytes: number,
    input: NumericalAllocation
  ) {
    this.type = input.type;
    this.length = input.length;
    this.lifetime = input.lifetime;
  }
  check() {
    requireThat(
      !this.released && !this.arena.isClosed(),
      "numerical_closed",
      "This numerical allocation has been released."
    );
  }
  retain() {
    this.check();
    this.lifetime = "run";
  }
  private range(start: number, count: number) {
    this.check();
    requireThat(
      Number.isSafeInteger(start) &&
        Number.isSafeInteger(count) &&
        start >= 0 &&
        count >= 0 &&
        start + count <= this.length,
      "numerical_range",
      "Access stays inside its numerical allocation."
    );
  }
  read(index: number) {
    this.range(index, 1);
    return this.arena.page(this, Math.floor(index / this.arena.pageSamples)).page.values[
      index % this.arena.pageSamples
    ];
  }
  write(index: number, value: number) {
    this.range(index, 1);
    const { page, retained } = this.arena.page(this, Math.floor(index / this.arena.pageSamples));
    page.values[index % this.arena.pageSamples] = value;
    this.arena.dirty(page, retained);
  }
  readBlock(start: number, count: number) {
    this.range(start, count);
    const result = new sampleConstructors[this.type](count);
    for (let at = 0; at < count;) {
      const from = (start + at) % this.arena.pageSamples,
        { page } = this.arena.page(this, Math.floor((start + at) / this.arena.pageSamples));
      const size = Math.min(count - at, page.values.length - from);
      result.set(page.values.subarray(from, from + size), at);
      at += size;
    }
    return result;
  }
  writeBlock(start: number, values: ArrayLike<number>) {
    this.range(start, values.length);
    for (let at = 0; at < values.length;) {
      const into = (start + at) % this.arena.pageSamples,
        { page, retained } = this.arena.page(
          this,
          Math.floor((start + at) / this.arena.pageSamples)
        );
      const size = Math.min(values.length - at, page.values.length - into);
      for (let i = 0; i < size; i++) page.values[into + i] = values[at + i];
      this.arena.dirty(page, retained);
      at += size;
    }
  }
  fill(start: number, count: number, value: number) {
    this.range(start, count);
    if (start === 0 && count === this.length) {
      this.released = true;
      this.arena.forget(this);
      this.released = false;
      this.written.clear();
      const converted = new sampleConstructors[this.type](1);
      converted[0] = value;
      this.initial = converted[0];
      return;
    }
    for (let at = 0; at < count;) {
      const into = (start + at) % this.arena.pageSamples,
        { page, retained } = this.arena.page(
          this,
          Math.floor((start + at) / this.arena.pageSamples)
        );
      const size = Math.min(count - at, page.values.length - into);
      page.values.fill(value, into, into + size);
      this.arena.dirty(page, retained);
      at += size;
    }
  }
  allocate(input: NumericalAllocation) {
    return this.arena.createStorage(input);
  }
  release() {
    if (this.released) return;
    this.released = true;
    this.arena.freeStorage(this);
  }
}
