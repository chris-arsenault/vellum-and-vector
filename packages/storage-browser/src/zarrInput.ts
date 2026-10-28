import {
  requireThat,
  type NumericalAllocation,
  type NumericalAllocator,
  type NumericalVector,
  type ResourceArray,
  type SampleArray,
} from "@atlas/domain";
import { NumericalView, numericalViewStorage } from "./numericalView";
import { sampleConstructors, type VectorStorage } from "./vectorStorage";
import type { BinarySnapshot, BinaryStore } from "./opfsStore";
import { ByteCache } from "./byteCache";

function chunkKeys(path: string, array: ResourceArray) {
  const counts = array.shape.map((n, i) => Math.ceil(n / array.chunkShape[i])),
    result: string[] = [];
  const visit = (axis: number, coordinates: number[]) => {
    if (axis === counts.length) {
      result.push(`${path}/c/${coordinates.join("/")}`);
      return;
    }
    for (let i = 0; i < counts[axis]; i++) visit(axis + 1, [...coordinates, i]);
  };
  visit(0, []);
  return result;
}
function validateMetadata(metadata: Record<string, unknown>, array: ResourceArray) {
  const codecs = metadata.codecs as { name: string; configuration?: { endian?: string } }[];
  const layout = {
    chunk_grid: { name: "regular", configuration: { chunk_shape: array.chunkShape } },
    chunk_key_encoding: { name: "default", configuration: { separator: "/" } },
  };
  requireThat(
    Object.entries(layout).every(
      ([name, value]) => JSON.stringify(metadata[name]) === JSON.stringify(value)
    ),
    "resource_encoding",
    "Direct inputs retain the declared Zarr chunk grid and key encoding."
  );
  requireThat(
    metadata.zarr_format === 3 &&
      metadata.node_type === "array" &&
      metadata.data_type === array.dtype &&
      JSON.stringify(metadata.shape) === JSON.stringify(array.shape),
    "resource_encoding",
    "Numerical input metadata must retain its declared type and shape."
  );
  requireThat(
    Array.isArray(codecs) &&
      codecs.length <= 1 &&
      codecs.every(
        (codec) =>
          codec.name === "bytes" && [undefined, "little"].includes(codec.configuration?.endian)
      ),
    "resource_encoding",
    "Direct inputs use the declared uncompressed little-endian Zarr bytes."
  );
  const check = new Uint16Array([1]);
  requireThat(
    new Uint8Array(check.buffer)[0] === 1,
    "resource_encoding",
    "Direct numerical views require little-endian typed arrays."
  );
}
export async function openZarrInput(
  store: BinaryStore,
  path: string,
  array: ResourceArray,
  allocator: NumericalAllocator,
  cache: ByteCache<string, SampleArray>
): Promise<NumericalVector> {
  const metadataBytes = await store.get(`${path}/zarr.json`);
  requireThat(metadataBytes, "resource_encoding", "Numerical input metadata is missing.");
  const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
  validateMetadata(metadata, array);
  const snapshot = await store.snapshot(chunkKeys(path, array));
  const input = new ZarrInput(path, array, snapshot, allocator, cache);
  // Inside the resident budget the input is decoded once into a native array; chunk files
  // are released immediately. Above it, the chunked view reads on demand.
  const resident = allocator.allocate({
    type: array.dtype,
    length: input.length,
    lifetime: "run",
    name: `input:${path}`,
  });
  if (!ArrayBuffer.isView(resident)) {
    allocator.release(resident);
    return new NumericalView(input).view;
  }
  try {
    const block = 1 << 16;
    for (let start = 0; start < input.length; start += block)
      (resident as SampleArray).set(
        input.readBlock(start, Math.min(block, input.length - start)),
        start
      );
  } finally {
    input.release();
  }
  Object.defineProperty(resident, "immutable", { value: true });
  return resident;
}
class ZarrInput implements VectorStorage {
  readonly immutable = true;
  readonly type;
  readonly length;
  private closed = false;
  private current?: { key: string; row: number; column: number };
  constructor(
    private path: string,
    private array: ResourceArray,
    private snapshot: BinarySnapshot,
    private allocator: NumericalAllocator,
    private cache: ByteCache<string, SampleArray>
  ) {
    this.type = array.dtype;
    this.length = array.shape.reduce((a, b) => a * b, 1);
  }
  private address(index: number) {
    requireThat(!this.closed, "resource_closed", "This numerical input has been closed.");
    requireThat(
      Number.isInteger(index) && index >= 0 && index < this.length,
      "numerical_range",
      "Read stays inside its numerical input."
    );
    const coordinates = new Array<number>(this.array.shape.length);
    let cell = index,
      within = 0,
      stride = 1;
    for (let axis = coordinates.length - 1; axis >= 0; axis--) {
      const coordinate = cell % this.array.shape[axis],
        size = this.array.chunkShape[axis];
      cell = Math.floor(cell / this.array.shape[axis]);
      coordinates[axis] = Math.floor(coordinate / size);
      within += (coordinate % size) * stride;
      stride *= size;
    }
    const last = this.array.shape.length - 1,
      coordinate = index % this.array.shape[last],
      contiguous = Math.min(
        this.array.shape[last] - coordinate,
        this.array.chunkShape[last] - (coordinate % this.array.chunkShape[last])
      );
    return { key: `${this.path}/c/${coordinates.join("/")}`, within, contiguous };
  }
  read(index: number) {
    const previous = this.cachedValue(index);
    if (previous !== undefined) return previous;
    const { key, within } = this.address(index);
    const values = this.chunk(key);
    if (this.array.shape.length <= 2) {
      const width = this.array.shape.at(-1)!,
        rows = this.array.chunkShape.length === 1 ? 1 : this.array.chunkShape[0],
        columns = this.array.chunkShape.at(-1)!;
      this.current = {
        key,
        row: Math.floor(Math.floor(index / width) / rows) * rows,
        column: Math.floor((index % width) / columns) * columns,
      };
    }
    return values[within];
  }
  private cachedValue(index: number) {
    const cached = this.current;
    if (!cached || this.closed || !Number.isInteger(index) || index < 0 || index >= this.length)
      return;
    const width = this.array.shape.at(-1)!,
      row = Math.floor(index / width),
      column = index % width,
      rows = this.array.chunkShape.length === 1 ? 1 : this.array.chunkShape[0],
      columns = this.array.chunkShape.at(-1)!;
    if (!insideChunk(row, column, cached, rows, columns)) return;
    return this.cache.peek(cached.key)?.[(row - cached.row) * columns + column - cached.column];
  }
  private chunk(key: string) {
    const previous = this.cache.get(key);
    if (previous) return previous;
    const bytes = this.snapshot.read(key);
    requireThat(bytes, "incomplete_resource", "A completed input chunk is missing.");
    const Constructor = sampleConstructors[this.type],
      count = this.array.chunkShape.reduce((a, b) => a * b, 1);
    requireThat(
      bytes.byteLength === count * Constructor.BYTES_PER_ELEMENT,
      "resource_samples",
      "Input chunks retain their declared type and shape."
    );
    const values = new Constructor(Uint8Array.from(bytes).buffer);
    this.cache.set(key, values, values.byteLength);
    return values;
  }
  readBlock(start: number, count: number) {
    requireThat(
      start >= 0 && count >= 0 && start + count <= this.length,
      "numerical_range",
      "Read stays inside its numerical input."
    );
    const result = new sampleConstructors[this.type](count);
    for (let i = 0; i < count;) {
      const { key, within, contiguous } = this.address(start + i),
        size = Math.min(count - i, contiguous);
      result.set(this.chunk(key).subarray(within, within + size), i);
      i += size;
    }
    return result;
  }
  write() {
    throw new Error("Immutable numerical input requires a separate working output.");
  }
  writeBlock() {
    this.write();
  }
  fill() {
    this.write();
  }
  retain() {
    requireThat(!this.closed, "resource_closed", "This numerical input has been closed.");
  }
  release() {
    this.closed = true;
    this.current = undefined;
    this.snapshot.close();
  }
  allocate(input: NumericalAllocation) {
    return numericalViewStorage(this.allocator.allocate(input)).storage;
  }
}
function insideChunk(
  row: number,
  column: number,
  start: { row: number; column: number },
  rows: number,
  columns: number
) {
  return (
    row >= start.row &&
    row < start.row + rows &&
    column >= start.column &&
    column < start.column + columns
  );
}
