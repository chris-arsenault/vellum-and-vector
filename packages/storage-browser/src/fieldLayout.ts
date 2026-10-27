import {
  adaptiveCell,
  numericalSampleType,
  requireThat,
  type Bounds,
  type Grid,
  type NumericalResource,
  type NumericalVector,
  type PartitionReference,
  type ResourceArray,
  type SampleArray,
} from "@atlas/domain";

export const fieldPartitionSamples = 16_384;
export const regularPartitionWidth = 256;
export const regularPartitionHeight = 64;
export interface LayoutVector {
  array: ResourceArray;
  values: NumericalVector;
  group: "cells" | "faces" | "tree";
  components: number;
  read?: (start: number, count: number) => SampleArray;
}
export function layoutVector(
  name: string,
  values: NumericalVector,
  group: LayoutVector["group"],
  components = 1
): LayoutVector {
  const dtype = numericalSampleType(values);
  requireThat(dtype, "field_storage", "Field storage needs declared sample types.");
  return {
    values,
    group,
    components,
    array: {
      name,
      dtype,
      shape: [values.length],
      chunkShape: [fieldPartitionSamples * components],
      unit: name === "measures" ? "square-metre" : "topology",
      quantity: name === "measures" ? "extensive" : "topology",
    },
  };
}
function cellExtent(grid: Grid, start: number, count: number): Bounds {
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  requireThat(grid.topology, "field_layout", "Adaptive partitions require topology.");
  for (let i = start; i < start + count; i++) {
    const box = adaptiveCell(grid.topology, i);
    bounds[0] = Math.min(bounds[0], box[0]);
    bounds[1] = Math.min(bounds[1], box[1]);
    bounds[2] = Math.max(bounds[2], box[2]);
    bounds[3] = Math.max(bounds[3], box[3]);
  }
  return count ? bounds : grid.bounds;
}
function faceOwner(offsets: NumericalVector, face: number) {
  let low = 0,
    high = offsets.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= face) low = middle;
    else high = middle;
  }
  return low;
}
export function linearPartitions(grid: Grid, vectors: LayoutVector[]): PartitionReference[] {
  const partitions: PartitionReference[] = [];
  const groups = [...new Set(vectors.map((v) => v.group))];
  for (const group of groups) {
    const members = vectors.filter((v) => v.group === group),
      length =
        group === "cells"
          ? grid.active.length
          : Math.max(...members.map((v) => v.array.shape[0] / v.components));
    for (let start = 0; start < Math.max(1, length); start += fieldPartitionSamples) {
      const count = Math.min(fieldPartitionSamples, length - start);
      partitions.push(linearPartition(grid, vectors, group, start, count));
    }
  }
  return partitions;
}
function linearPartition(
  grid: Grid,
  vectors: LayoutVector[],
  group: LayoutVector["group"],
  start: number,
  count: number
): PartitionReference {
  const topology = grid.topology!;
  const first = group === "faces" && count ? faceOwner(topology.offsets, start) : start;
  const last =
    group === "faces" && count ? faceOwner(topology.offsets, start + count - 1) + 1 : start + count;
  const bounds =
    group === "tree"
      ? grid.bounds
      : cellExtent(grid, first, Math.min(last, grid.active.length) - first);
  return {
    id: `${group}:${start}`,
    bounds,
    cellStart: first,
    cellCount: group === "cells" ? Math.min(count, grid.active.length - start) : 0,
    neighbors: [],
    arraySlices: Object.fromEntries(
      vectors.map(({ array, group: owner, components }) => {
        const offset = owner === group ? start * components : 0;
        const requested =
          count * components + Number(group === "cells" && array.name === "offsets");
        const size = owner === group ? Math.min(requested, array.shape[0] - offset) : 0;
        return [array.name, { offset: [offset], shape: [size] }];
      })
    ),
  };
}
export function regularPartitions(grid: Grid, arrays: ResourceArray[]): PartitionReference[] {
  requireThat(!grid.topology, "field_layout", "Regular partitions require a regular field.");
  const result: PartitionReference[] = [],
    [x0, y0, x1, y1] = grid.bounds;
  const dx = (x1 - x0) / (grid.width - 1),
    dy = (y1 - y0) / (grid.height - 1);
  for (let y = 0; y < grid.height; y += regularPartitionHeight)
    for (let x = 0; x < grid.width; x += regularPartitionWidth) {
      const width = Math.min(regularPartitionWidth, grid.width - x),
        height = Math.min(regularPartitionHeight, grid.height - y);
      result.push({
        id: `cells:${x}:${y}`,
        cellStart: y * grid.width + x,
        cellCount: width * height,
        bounds: [
          Math.max(x0, x0 + (x - 0.5) * dx),
          Math.max(y0, y0 + (y - 0.5) * dy),
          Math.min(x1, x0 + (x + width - 0.5) * dx),
          Math.min(y1, y0 + (y + height - 0.5) * dy),
        ],
        neighbors: [],
        arraySlices: Object.fromEntries(
          arrays.map(({ name }) => [name, { offset: [y, x], shape: [height, width] }])
        ),
      });
    }
  return result;
}
export function resourceBase(grid: Grid, id: string): NumericalResource {
  return {
    schemaVersion: 1,
    id,
    revision: 1,
    scope: {
      worldId: grid.scope.worldId,
      spaceId: grid.scope.spaceId,
      areaId: grid.scope.areaId,
    },
    crsId: grid.scope.crsId,
    bounds: grid.bounds,
    precision: 0.000001,
    periodicWidth: grid.periodicWidth,
    layout: grid.topology ? "adaptive" : "regular",
    sampling: grid.topology ? undefined : { width: grid.width, height: grid.height },
    state: "working",
    arrays: [],
    partitions: [],
  };
}
