import {
  Band,
  blockShift,
  newBlock,
  requireThat,
  type BlockArray,
  type BlockCache,
  type ResourceArray,
  type SampleArray,
} from "@atlas/domain";
import type { BinarySnapshot, BinaryStore } from "./opfsStore";
import { ByteCache } from "./byteCache";

/** A committed array open as an immutable band; closing releases the band and its snapshot. */
export interface FieldInput {
  values: Band;
  close(): void;
}
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
/**
 * Open a committed array as a band whose blocks decode from its chunks on demand. Nothing
 * decodes the whole array; the block cache decides what stays resident, and an evicted
 * block reloads from the committed chunk rather than spilling.
 */
export async function openZarrInput(
  store: BinaryStore,
  path: string,
  array: ResourceArray,
  blocks: BlockCache,
  chunks: ByteCache<string, SampleArray>
): Promise<FieldInput> {
  const metadataBytes = await store.get(`${path}/zarr.json`);
  requireThat(metadataBytes, "resource_encoding", "Numerical input metadata is missing.");
  const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
  validateMetadata(metadata, array);
  const snapshot = await store.snapshot(chunkKeys(path, array));
  const input = new ZarrInput(path, array, snapshot, chunks);
  const values = new Band(
    { name: `input:${path}`, type: array.dtype, lifetime: "run", immutable: true },
    input.length,
    blocks,
    (block, into) => input.readBlock(block << blockShift, into)
  );
  return {
    values,
    close() {
      values.release();
      input.release();
    },
  };
}
class ZarrInput {
  readonly length;
  private closed = false;
  constructor(
    private path: string,
    private array: ResourceArray,
    private snapshot: BinarySnapshot,
    private cache: ByteCache<string, SampleArray>
  ) {
    this.length = array.shape.reduce((a, b) => a * b, 1);
  }
  private chunk(key: string) {
    const previous = this.cache.get(key);
    if (previous) return previous;
    const bytes = this.snapshot.read(key);
    requireThat(bytes, "incomplete_resource", "A completed input chunk is missing.");
    const count = this.array.chunkShape.reduce((a, b) => a * b, 1),
      values = newBlock(this.array.dtype, count);
    requireThat(
      bytes.byteLength === values.byteLength,
      "resource_samples",
      "Input chunks retain their declared type and shape."
    );
    new Uint8Array(values.buffer).set(bytes);
    this.cache.set(key, values, values.byteLength);
    return values;
  }
  /**
   * Fill `into` with the samples from `start`. Chunk-major: each chunk the range touches is
   * decoded once and every row of it inside the range is copied, so a block of a tiled
   * raster costs one read per tile however many rows it spans.
   */
  readBlock(start: number, into: BlockArray) {
    requireThat(!this.closed, "resource_closed", "This numerical input has been closed.");
    requireThat(
      start >= 0 && start + into.length <= this.length && this.array.shape.length <= 2,
      "numerical_range",
      "Read stays inside its one- or two-dimensional numerical input."
    );
    if (!into.length) return;
    const { rows, columns, chunkRows, chunkColumns } = this.tiles(),
      firstRow = Math.floor(start / columns),
      lastRow = Math.min(rows - 1, Math.floor((start + into.length - 1) / columns));
    for (let tileRow = Math.floor(firstRow / chunkRows); tileRow * chunkRows <= lastRow; tileRow++)
      for (let tileColumn = 0; tileColumn * chunkColumns < columns; tileColumn++)
        this.copyTile(tileRow, tileColumn, [firstRow, lastRow], start, into);
  }
  /** The array as rows of tiles; a one-dimensional array is one row. */
  private tiles() {
    const { shape, chunkShape } = this.array,
      flat = shape.length === 1;
    return {
      rows: flat ? 1 : shape[0],
      columns: flat ? shape[0] : shape[1],
      chunkRows: flat ? 1 : chunkShape[0],
      chunkColumns: flat ? chunkShape[0] : chunkShape[1],
    };
  }
  /** Copy the rows of one tile that fall inside `[start, start + into.length)`. */
  private copyTile(
    tileRow: number,
    tileColumn: number,
    [firstRow, lastRow]: [number, number],
    start: number,
    into: BlockArray
  ) {
    const { columns, chunkRows, chunkColumns } = this.tiles(),
      end = start + into.length,
      c0 = tileColumn * chunkColumns,
      c1 = Math.min(columns, c0 + chunkColumns),
      key =
        this.array.shape.length === 1
          ? `${this.path}/c/${tileColumn}`
          : `${this.path}/c/${tileRow}/${tileColumn}`;
    let values: SampleArray | undefined;
    for (
      let row = Math.max(firstRow, tileRow * chunkRows);
      row <= Math.min(lastRow, tileRow * chunkRows + chunkRows - 1);
      row++
    ) {
      const from = Math.max(row * columns + c0, start),
        to = Math.min(row * columns + c1, end);
      if (from >= to) continue;
      values ??= this.chunk(key);
      const at = (row - tileRow * chunkRows) * chunkColumns + (from - row * columns - c0);
      into.set(values.subarray(at, at + to - from), from - start);
    }
  }
  release() {
    if (this.closed) return;
    this.closed = true;
    this.snapshot.close();
  }
}
