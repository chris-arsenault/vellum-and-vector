import { requireThat, type NumericalResource, type ResourceArray } from "@atlas/domain";
import { ByteCache } from "./byteCache";
import type { BinarySnapshot, BinaryStore } from "./opfsStore";
import { ResourceDescriptors } from "./resourceDescriptors";
import { resourcePrefix } from "./resourcePaths";
import { chunkKeys } from "./zarrInput";
import { decodedResourceCacheBytes } from "./zarrResources";

const cells = [
  "leaves",
  "offsets",
  "neighbors",
  "faceLengths",
  "distances",
  "directionX",
  "directionY",
  "normalX",
  "normalY",
];
const tree = ["boxes", "children", "levels", "leafIndex"];
const decoder = new TextDecoder();
interface Opened {
  metadata: string;
  input: PinnedChunks;
}

/** Each WASM band holds a lease; releasing the preparation owner does not close live bands. */
class PinnedChunks {
  private users = 1;
  constructor(
    private snapshot: BinarySnapshot,
    private path: string,
    private cache: ByteCache<string, Uint8Array>
  ) {}
  release() {
    if (--this.users === 0) this.snapshot.close();
  }
  acquire() {
    requireThat(this.users > 0, "resource_closed", "This numerical input has been closed.");
    this.users++;
    let closed = false;
    return {
      read: (key: string) => {
        requireThat(!closed, "resource_closed", "This numerical input has been closed.");
        const path = `${this.path}/${key}`,
          cached = this.cache.get(path);
        if (cached) return cached;
        const bytes = this.snapshot.read(path);
        requireThat(bytes, "incomplete_resource", "A completed input chunk is missing.");
        this.cache.set(path, bytes, bytes.byteLength);
        return bytes;
      },
      close: () => {
        if (closed) return;
        closed = true;
        this.release();
      },
    };
  }
}
/** Prepare asynchronous local storage reads once; WASM then decodes paged inputs itself. */
export class RustNumericalInputs {
  private descriptors;
  private ready = new Map<string, string>();
  private arrays = new Map<string, Opened>();
  private cache = new ByteCache<string, Uint8Array>(decodedResourceCacheBytes);
  private closed = false;
  constructor(private store: BinaryStore) {
    this.descriptors = new ResourceDescriptors(store);
  }
  prepareInput(id: string, names: string) {
    return this.prepare(id, JSON.parse(names) as string[]);
  }
  async prepareDescriptor(id: string) {
    return JSON.stringify(await this.descriptor(id));
  }
  async prepare(id: string, names: readonly string[]) {
    requireThat(!this.closed, "field_closed", "The numerical operation has ended.");
    const resource = await this.descriptor(id),
      field = resource.field;
    requireThat(field, "field_resource", "Load a completed field resource.");
    const selected = [
      "active",
      "measures",
      ...names.map((name) => {
        requireThat(
          Object.hasOwn(field.channels, name),
          "field_channel",
          `Requested channel ${name} must exist.`
        );
        return field.channels[name];
      }),
    ];
    if (field.materialCargo)
      selected.push(field.materialCargo.offsets, field.materialCargo.records);
    if (resource.layout === "adaptive") selected.push(...cells);
    try {
      for (const name of selected) await this.array(resource, name, new Set());
      if (resource.layout === "adaptive") {
        requireThat(
          field.treeResourceId,
          "field_layout",
          "Adaptive fields declare their tree resource."
        );
        const topology = await this.descriptor(field.treeResourceId);
        for (const name of tree) await this.array(topology, name, new Set());
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }
  private async descriptor(id: string) {
    const resource = await this.descriptors.get(id);
    requireThat(resource.state === "ready", "field_resource", "Load a completed field resource.");
    this.ready.set(id, JSON.stringify(resource));
    return resource;
  }
  private async array(resource: NumericalResource, name: string, path: Set<string>): Promise<void> {
    const key = `${resourcePrefix(resource.id)}/${name}`;
    if (this.arrays.has(key)) return;
    requireThat(
      !path.has(key),
      "resource_source",
      "Shared numerical arrays require acyclic references."
    );
    path.add(key);
    const array = resource.arrays.find((array) => array.name === name);
    requireThat(array, "resource_array", `Field layout requires ${name}.`);
    if (array.source) {
      await this.array(await this.descriptor(array.source.resourceId), array.source.array, path);
      return;
    }
    this.arrays.set(key, await this.open(key, array));
  }
  private async open(path: string, array: ResourceArray): Promise<Opened> {
    const metadata = await this.store.get(`${path}/zarr.json`);
    requireThat(metadata, "resource_encoding", "Numerical input metadata is missing.");
    return {
      metadata: decoder.decode(metadata),
      input: new PinnedChunks(await this.store.snapshot(chunkKeys(path, array)), path, this.cache),
    };
  }
  describe(id: string) {
    requireThat(!this.closed, "field_closed", "The numerical operation has ended.");
    const descriptor = this.ready.get(id);
    requireThat(descriptor, "field_resource", "Prepare the local resource before entering WASM.");
    return descriptor;
  }
  private opened(id: string, name: string) {
    requireThat(!this.closed, "field_closed", "The numerical operation has ended.");
    const opened = this.arrays.get(`${resourcePrefix(id)}/${name}`);
    requireThat(opened, "field_resource", "Prepare the local array before entering WASM.");
    return opened;
  }
  arrayMetadata(id: string, name: string) {
    return this.opened(id, name).metadata;
  }
  arraySnapshot(id: string, name: string) {
    return this.opened(id, name).input.acquire();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const opened of this.arrays.values()) opened.input.release();
    this.arrays.clear();
    this.ready.clear();
    this.cache.clear();
  }
}
