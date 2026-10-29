import {
  adaptiveCell,
  requireThat,
  type FieldGeography,
  type Grid,
  type NumericalResource,
  type ResourceStore,
} from "@atlas/domain";
import {
  layoutVector,
  linearPartitions,
  regularPartitions,
  regularPartitionHeight,
  regularPartitionWidth,
  resourceBase,
  type LayoutVector,
} from "./fieldLayout";
import { arraySelection, readBandPartition } from "./resourceVectors";
import { summarizeField } from "./fieldSummaries";

function layoutVectors(grid: Grid): LayoutVector[] {
  const vectors = [
    layoutVector("active", grid.active, "cells"),
    layoutVector("measures", grid.measures, "cells"),
  ];
  const topology = grid.topology;
  if (!topology)
    return vectors.map((vector) => ({
      ...vector,
      array: {
        ...vector.array,
        shape: [grid.height, grid.width],
        chunkShape: [regularPartitionHeight, regularPartitionWidth],
      },
    }));
  vectors.push(
    layoutVector("leaves", topology.leaves, "cells"),
    layoutVector("offsets", topology.offsets, "cells")
  );
  for (const name of [
    "neighbors",
    "faceLengths",
    "distances",
    "directionX",
    "directionY",
    "normalX",
    "normalY",
  ] as const)
    vectors.push(layoutVector(name, topology[name], "faces"));
  const bounds = layoutVector("cellBounds", topology.boxes, "cells", 4);
  bounds.array.shape = [grid.active.length * 4];
  bounds.read = (start, count) => {
    const result = new Float64Array(count);
    for (let at = 0; at < count; at += 4) result.set(adaptiveCell(topology, (start + at) / 4), at);
    return result;
  };
  vectors.push(bounds);
  return vectors;
}
async function writeVectors(
  store: ResourceStore,
  resource: NumericalResource,
  vectors: LayoutVector[],
  check: () => void
) {
  check();
  await store.create(resource);
  try {
    for (const reference of resource.partitions) {
      check();
      const arrays: import("@atlas/domain").ResourcePartition["arrays"] = {};
      for (const vector of vectors) {
        const spec = arraySelection(vector.array, reference);
        arrays[vector.array.name] = vector.read
          ? vector.read(spec.offset[0], spec.shape[0])
          : readBandPartition(vector.values, vector.array, reference);
      }
      await store.writePartition(resource.id, { reference, arrays });
    }
    return await store.finish(resource.id);
  } catch (error) {
    await store.remove(resource.id);
    throw error;
  }
}
export interface FieldLayoutResources {
  layout: NumericalResource;
  tree?: NumericalResource;
  geography: FieldGeography;
}
/** Write topology once; fields sharing these samples alias immutable layout arrays. */
export async function writeFieldLayout(
  store: ResourceStore,
  grid: Grid,
  id: string,
  precision: number,
  check: () => void = () => {}
): Promise<FieldLayoutResources> {
  requireThat(
    Number.isFinite(precision) && precision > 0,
    "field_precision",
    "Field precision is a positive metre distance."
  );
  const vectors = layoutVectors(grid),
    layout = resourceBase(grid, id);
  layout.precision = precision;
  layout.arrays = vectors.map((v) => v.array);
  layout.partitions = grid.topology
    ? linearPartitions(grid, vectors)
    : regularPartitions(grid, layout.arrays);
  const ready = await writeVectors(store, layout, vectors, check);
  let tree: NumericalResource | undefined;
  try {
    if (grid.topology) {
      const topology = grid.topology,
        definition = resourceBase(grid, `${id}:tree`);
      definition.bounds = topology.bounds;
      const treeVectors = [
        layoutVector("boxes", topology.boxes, "tree", 4),
        ...(["children", "levels", "leafIndex"] as const).map((name) =>
          layoutVector(name, topology[name], "tree")
        ),
      ];
      definition.precision = precision;
      definition.arrays = treeVectors.map((v) => v.array);
      definition.partitions = linearPartitions(grid, treeVectors);
      tree = await writeVectors(store, definition, treeVectors, check);
    }
    return {
      layout: ready,
      tree,
      geography: {
        id,
        scope: ready.scope,
        ocean: grid.ocean,
        waterBodies: grid.waterBodies,
        lakes: grid.lakes,
      },
    };
  } catch (error) {
    await store.remove(ready.id);
    throw error;
  }
}
/** Channel writes use bounded buffers and never transfer the execution arena to the editor. */
export async function writeFieldChannels(
  store: ResourceStore,
  grid: Grid,
  id: string,
  shared: FieldLayoutResources,
  names = Object.keys(grid.channels),
  check: () => void = () => {}
) {
  const layout = shared.layout;
  validateLayout(grid, layout);
  const resource = resourceBase(grid, id),
    channelVectors: LayoutVector[] = [];
  resource.precision = layout.precision;
  resource.arrays = layout.arrays.map((array) => ({
    ...array,
    source: { resourceId: layout.id, array: array.name },
  }));
  resource.partitions = structuredClone(layout.partitions);
  resource.field = {
    id: grid.id,
    scope: grid.scope,
    layoutResourceId: layout.id,
    treeResourceId: shared.tree?.id,
    geographyId: shared.geography.id,
    channels: {},
  };
  for (const [index, name] of names.entries()) {
    const vector = channelVector(grid, name, index),
      array = vector.array;
    resource.arrays.push(array);
    channelVectors.push(vector);
    resource.field.channels[name] = array.name;
    for (const partition of resource.partitions)
      partition.arraySlices![array.name] = structuredClone(partition.arraySlices!.active);
  }
  Object.assign(resource.field, summarizeField(grid, resource));
  return writeVectors(store, resource, channelVectors, check);
}
function validateLayout(grid: Grid, layout: NumericalResource) {
  requireThat(layout.state === "ready", "field_layout", "Fields reference a completed layout.");
  requireThat(
    layout.scope.worldId === grid.scope.worldId &&
      layout.scope.spaceId === grid.scope.spaceId &&
      layout.scope.areaId === grid.scope.areaId &&
      layout.bounds.every((value, i) => value === grid.bounds[i]),
    "field_layout",
    "Field channels belong to the shared located layout."
  );
  requireThat(
    grid.active.length ===
      layout.arrays.find((a) => a.name === "active")!.shape.reduce((a, b) => a * b, 1),
    "field_layout",
    "Field samples retain the shared layout size."
  );
}
function channelVector(grid: Grid, name: string, index: number): LayoutVector {
  const values = grid.channels[name];
  requireThat(
    values?.length === grid.active.length,
    "field_channel",
    `Field channel ${name} needs one value per sample.`
  );
  const vector = layoutVector(`channel_${index}`, values, "cells");
  requireThat(
    vector.array.dtype === "float64",
    "field_channel",
    "Field channels retain float64 samples."
  );
  vector.array.unit = grid.units[name];
  vector.array.quantity =
    grid.quantities?.[name] ?? (grid.units[name] === "category" ? "category" : "intensive");
  if (!grid.topology) {
    vector.array.shape = [grid.height, grid.width];
    vector.array.chunkShape = [regularPartitionHeight, regularPartitionWidth];
  }
  return vector;
}
