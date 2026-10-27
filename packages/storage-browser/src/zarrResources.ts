import * as zarr from "zarrita";
import {
  partitionsInWindow,
  requireThat,
  validateResourceArray,
  type NumericalResource,
  type ResourceStore,
  type ResourceWindow,
  type ResourcePartition,
  type PartitionReference,
  type ResourceArray,
  type SampleArray,
  type NumericalAllocator,
} from "@atlas/domain";
import type { BinaryStore } from "./opfsStore";
import { ByteCache } from "./byteCache";
import { ResourceDescriptors } from "./resourceDescriptors";
import { resourcePrefix as prefix } from "./resourcePaths";
import { arraySelection } from "./resourceVectors";
import { openZarrInput } from "./zarrInput";

export const decodedResourceCacheBytes = 32 * 1024 * 1024;
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const constructors = {
  float64: Float64Array,
  float32: Float32Array,
  int32: Int32Array,
  uint32: Uint32Array,
  uint8: Uint8Array,
  int8: Int8Array,
};
function selection(array: ResourceArray, partition: PartitionReference) {
  const spec = partition.arraySlices?.[array.name] ?? {
    offset: [partition.cellStart],
    shape: [partition.cellCount],
  };
  requireThat(
    spec.offset.length === array.shape.length && spec.shape.length === array.shape.length,
    "resource_partition",
    "Partition dimensions must match the array."
  );
  requireThat(
    spec.shape.every(
      (n, i) =>
        Number.isSafeInteger(n) &&
        n >= 0 &&
        Number.isSafeInteger(spec.offset[i]) &&
        spec.offset[i] >= 0 &&
        spec.offset[i] + n <= array.shape[i]
    ),
    "resource_partition",
    "Partition must be inside the array."
  );
  return {
    ...spec,
    slices: spec.offset.map((start, i) => zarr.slice(start, start + spec.shape[i])),
  };
}
function stride(shape: number[]) {
  let size = 1;
  return shape
    .map((_, i) => i)
    .reverse()
    .map((i) => {
      const value = size;
      size *= shape[i];
      return value;
    })
    .reverse();
}
function serialQueue() {
  let pending = Promise.resolve();
  return {
    add(work: () => Promise<void>) {
      pending = pending.then(work);
    },
    onIdle() {
      return pending.then(() => []);
    },
  };
}

export class ZarrResources implements ResourceStore {
  private cache: ByteCache<string, SampleArray>;
  private descriptors: ResourceDescriptors;
  constructor(
    private store: BinaryStore,
    cacheBytes = decodedResourceCacheBytes
  ) {
    this.cache = new ByteCache(cacheBytes);
    this.descriptors = new ResourceDescriptors(store);
  }
  private async json<T>(key: string): Promise<T | null> {
    const bytes = await this.store.get(key);
    return bytes ? JSON.parse(decoder.decode(bytes)) : null;
  }
  async describe(id: string) {
    return structuredClone(await this.descriptors.get(id));
  }
  async openArray(id: string, name: string, allocator: NumericalAllocator) {
    const resource = await this.descriptors.get(id),
      array = resource.arrays.find((a) => a.name === name);
    requireThat(
      resource.state === "ready" && array,
      "field_resource",
      "Direct numerical inputs require a completed resource and an existing array."
    );
    const source = await this.location(resource, array);
    requireThat(
      source.resource.state === "ready",
      "field_resource",
      "Shared inputs must be complete."
    );
    return openZarrInput(
      this.store,
      `${prefix(source.resource.id)}/${source.array.name}`,
      source.array,
      allocator,
      this.cache
    );
  }
  async create(resource: NumericalResource) {
    requireThat(
      resource.state === "working",
      "resource_state",
      "Create a working resource before publication."
    );
    const path = prefix(resource.id);
    requireThat(
      !(await this.store.get(`${path}/resource.json`)),
      "existing_resource",
      "Resource already exists."
    );
    requireThat(
      new Set(resource.arrays.map((a) => a.name)).size === resource.arrays.length,
      "resource_array",
      "Resource arrays need unique names."
    );
    requireThat(
      new Set(resource.partitions.map((p) => p.id)).size === resource.partitions.length,
      "resource_partition",
      "Partition identities must be unique."
    );
    try {
      await this.createArrays(resource);
      await this.descriptors.set(resource);
    } catch (error) {
      this.descriptors.remove(resource.id);
      await this.store.deletePrefix(path);
      throw error;
    }
  }
  // Zarr resolves URL paths. Namespace the store so opaque resource IDs are never URL-decoded.
  private arrayLocation(id: string, name: string) {
    const path = prefix(id),
      store = this.store;
    return new zarr.Location(
      {
        get: (key: string) => store.get(`${path}${key}`),
        set: (key: string, bytes: Uint8Array) => store.set(`${path}${key}`, bytes),
      },
      `/${name}`
    );
  }
  private async createArrays(resource: NumericalResource) {
    for (const array of resource.arrays) {
      validateResourceArray(array);
      for (const partition of resource.partitions) selection(array, partition);
      if (array.source) {
        await this.validateSource(resource, array);
        continue;
      }
      await zarr.create(this.arrayLocation(resource.id, array.name), {
        dtype: array.dtype,
        shape: array.shape,
        chunkShape: array.chunkShape,
        attributes: { unit: array.unit, quantity: array.quantity },
      });
    }
  }
  async *readWindow(window: ResourceWindow) {
    const resource = await this.descriptors.get(window.resourceId);
    for (const reference of partitionsInWindow(resource, window)) {
      const selected = window.arrays.filter((name) =>
        arraySelection(
          resource.arrays.find((a) => a.name === name)!,
          reference
        ).shape.every((n) => n > 0)
      );
      if (selected.length) yield await this.readPartition(resource.id, reference.id, selected);
    }
  }
  async readPartition(resourceId: string, partitionId: string, names: string[]) {
    const resource = await this.descriptors.get(resourceId);
    const reference = resource.partitions.find((p) => p.id === partitionId);
    requireThat(reference, "resource_partition", "Partition does not exist.");
    const specs = names.map((name) => {
      const spec = resource.arrays.find((a) => a.name === name);
      requireThat(spec, "resource_array", `No ${name} in this resource.`);
      return spec;
    });
    if (resource.state === "working") {
      const written =
        (await this.json<string[]>(
          `${prefix(resourceId)}/written/${encodeURIComponent(partitionId)}.json`
        )) ?? [];
      requireThat(
        specs.every((spec) => spec.source || written.includes(spec.name)),
        "incomplete_resource",
        "Requested partition arrays have not been written."
      );
    }
    const arrays: ResourcePartition["arrays"] = {};
    for (const spec of specs) arrays[spec.name] = await this.readArray(resource, reference, spec);
    return { reference: structuredClone(reference), arrays };
  }
  private async readArray(
    resource: NumericalResource,
    partition: PartitionReference,
    spec: ResourceArray
  ) {
    const location = await this.location(resource, spec);
    const region = selection(spec, partition);
    if (region.shape.some((n) => n === 0)) return new constructors[spec.dtype](0);
    const key = `${location.resource.id}:${location.resource.revision}:${location.array.name}:${JSON.stringify([region.offset, region.shape])}`;
    const retained = resource.state === "ready" ? this.cache.get(key) : undefined;
    // Callers own returned arrays; modifying a working chunk must not alter a cached input.
    if (retained) return retained.slice() as SampleArray;
    const array = await zarr.open(this.arrayLocation(location.resource.id, location.array.name), {
      kind: "array",
    });
    const result = await zarr.get(array, region.slices, {
      createQueue: serialQueue,
    });
    const data = result.data as SampleArray;
    if (resource.state === "ready")
      this.cache.set(key, data.slice() as SampleArray, data.byteLength);
    return data;
  }
  async writePartition(resourceId: string, partition: ResourcePartition) {
    const resource = await this.descriptors.get(resourceId),
      path = prefix(resourceId);
    requireThat(
      resource.state === "working",
      "resource_immutable",
      "Completed resources cannot be changed."
    );
    const reference = resource.partitions.find((p) => p.id === partition.reference.id);
    requireThat(
      reference && JSON.stringify(reference) === JSON.stringify(partition.reference),
      "resource_partition",
      "Write must retain the declared partition identity."
    );
    const marker = `${path}/written/${encodeURIComponent(reference.id)}.json`;
    const written = new Set((await this.json<string[]>(marker)) ?? []);
    for (const [name, data] of Object.entries(partition.arrays)) {
      const spec = resource.arrays.find((a) => a.name === name);
      requireThat(spec, "resource_array", `No ${name} in this resource.`);
      requireThat(!spec.source, "resource_immutable", "Shared input arrays cannot be changed.");
      const region = selection(spec, reference);
      requireThat(
        data instanceof constructors[spec.dtype] &&
          data.length === region.shape.reduce((a, b) => a * b, 1),
        "resource_samples",
        "Samples must retain the declared type and shape."
      );
      if (!data.length) {
        written.add(name);
        continue;
      }
      const array = await zarr.open(this.arrayLocation(resource.id, name), {
        kind: "array",
      });
      await zarr.set(
        array,
        region.slices,
        { data, shape: region.shape, stride: stride(region.shape) },
        { createQueue: serialQueue }
      );
      written.add(name);
    }
    await this.store.set(marker, encoder.encode(JSON.stringify([...written])));
  }
  async finish(resourceId: string) {
    const resource = await this.descriptors.get(resourceId),
      path = prefix(resourceId);
    if (resource.state === "ready") return structuredClone(resource);
    for (const partition of resource.partitions) {
      const written =
        (await this.json<string[]>(`${path}/written/${encodeURIComponent(partition.id)}.json`)) ??
        [];
      requireThat(
        resource.arrays.every((a) => a.source || written.includes(a.name)),
        "incomplete_resource",
        "Finish every declared partition and array before publication."
      );
    }
    const ready: NumericalResource = { ...resource, state: "ready" };
    await this.descriptors.set(ready);
    return structuredClone(ready);
  }
  async remove(resourceId: string) {
    this.cache.clear();
    this.descriptors.remove(resourceId);
    await this.store.deletePrefix(prefix(resourceId));
  }
  private async validateSource(resource: NumericalResource, array: ResourceArray) {
    const source = await this.descriptors.get(array.source!.resourceId),
      original = source.arrays.find((a) => a.name === array.source!.array);
    requireThat(
      source.state === "ready" &&
        source.scope.worldId === resource.scope.worldId &&
        source.scope.spaceId === resource.scope.spaceId,
      "resource_source",
      "Shared arrays need a ready resource in the same located world."
    );
    requireThat(
      original &&
        original.dtype === array.dtype &&
        original.unit === array.unit &&
        original.quantity === array.quantity &&
        JSON.stringify([original.shape, original.chunkShape, source.bounds]) ===
          JSON.stringify([array.shape, array.chunkShape, resource.bounds]),
      "resource_source",
      "Shared arrays retain their shape, chunks, units and quantities."
    );
  }
  private async location(
    resource: NumericalResource,
    array: ResourceArray
  ): Promise<{ resource: NumericalResource; array: ResourceArray }> {
    if (!array.source) return { resource, array };
    const source = await this.descriptors.get(array.source.resourceId),
      original = source.arrays.find((a) => a.name === array.source!.array);
    requireThat(original, "resource_source", "The shared array is unavailable.");
    return this.location(source, original);
  }
}
