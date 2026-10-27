import {
  rectangle,
  spatial,
  type Bounds,
  type ChannelSummary,
  type Grid,
  type NumericalResource,
  type PartitionReference,
  type ResourcePartition,
  type ResourceStore,
  type SampleArray,
} from "@atlas/domain";
import type { Geometry } from "geojson";
import { readVectorPartition } from "./resourceVectors";

function summarize(values: SampleArray, active: SampleArray, categorical: boolean): ChannelSummary {
  let minimum = Infinity,
    maximum = -Infinity;
  const categories = new Set<number>();
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!active[i] || !Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    if (categorical) categories.add(value);
  }
  return { range: [minimum, maximum], categories: [...categories].sort((a, b) => a - b) };
}
export function summarizeField(grid: Grid, resource: NumericalResource) {
  const field = resource.field!,
    activeArray = resource.arrays.find((array) => array.name === "active")!;
  const summaries: Record<string, ChannelSummary> = {},
    partitionSummaries: Record<string, Record<string, ChannelSummary>> = {};
  for (const partition of resource.partitions) {
    if (!partition.cellCount) continue;
    const active = readVectorPartition(grid.active, activeArray, partition),
      current: Record<string, ChannelSummary> = {};
    for (const [name, key] of Object.entries(field.channels)) {
      const array = resource.arrays.find((array) => array.name === key)!,
        summary = summarize(
          readVectorPartition(grid.channels[name], array, partition),
          active,
          array.quantity === "category"
        );
      current[name] = summary;
      const previous = summaries[name] ?? { range: [Infinity, -Infinity], categories: [] };
      summaries[name] = mergeSummary(previous, summary);
    }
    partitionSummaries[partition.id] = current;
  }
  // JSON cannot carry infinities. Empty partitions have no categories or range contribution.
  for (const values of [summaries, ...Object.values(partitionSummaries)])
    for (const summary of Object.values(values))
      if (!Number.isFinite(summary.range[0])) summary.range = [0, 1];
  return { summaries, partitionSummaries };
}
export function mergeSummary(a: ChannelSummary, b: ChannelSummary): ChannelSummary {
  return {
    range: [Math.min(a.range[0], b.range[0]), Math.max(a.range[1], b.range[1])],
    categories: [...new Set([...a.categories, ...b.categories])].sort((x, y) => x - y),
  };
}
/** Read samples only in partitions cut by the visible footprint. */
export async function resourceCategories(
  store: ResourceStore,
  resource: NumericalResource,
  channel: string,
  footprint: Geometry
): Promise<number[]> {
  const field = resource.field!,
    summary = field.summaries?.[channel];
  if (summary && spatial.covers(footprint, field.scope.footprint)) return summary.categories;
  const categories = new Set<number>(),
    key = field.channels[channel];
  for (const partition of resource.partitions) {
    if (!partition.cellCount || !spatial.intersects(rectangle(partition.bounds), footprint))
      continue;
    await partitionCategories(store, resource, partition, channel, key, footprint, categories);
  }
  return [...categories].sort((a, b) => a - b);
}
async function partitionCategories(
  store: ResourceStore,
  resource: NumericalResource,
  partition: PartitionReference,
  channel: string,
  key: string,
  footprint: Geometry,
  categories: Set<number>
) {
  const saved = resource.field!.partitionSummaries?.[partition.id]?.[channel];
  if (saved && spatial.covers(footprint, rectangle(partition.bounds))) {
    for (const code of saved.categories) categories.add(code);
    return;
  }
  const names = ["active", key];
  if (resource.layout === "adaptive") names.push("cellBounds");
  const loaded = await store.readPartition(resource.id, partition.id, names);
  collectPartial(resource, loaded, key, footprint, categories);
}
function collectPartial(
  resource: NumericalResource,
  loaded: ResourcePartition,
  channel: string,
  footprint: Geometry,
  categories: Set<number>
) {
  const values = loaded.arrays[channel],
    active = loaded.arrays.active;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!active[i] || !Number.isFinite(value) || categories.has(value)) continue;
    const bounds = loaded.arrays.cellBounds
      ? (Array.from(loaded.arrays.cellBounds.subarray(i * 4, i * 4 + 4)) as Bounds)
      : regularCellBounds(resource, loaded.reference, i);
    const overlap = spatial.intersection(rectangle(bounds), footprint);
    if (overlap && spatial.area(overlap) > 0) categories.add(value);
  }
}
function regularCellBounds(
  resource: NumericalResource,
  partition: PartitionReference,
  i: number
): Bounds {
  const {
      offset: [row, column],
      shape: [, width],
    } = partition.arraySlices!.active,
    [x0, y0, x1, y1] = resource.bounds,
    dx = (x1 - x0) / (resource.sampling!.width - 1),
    dy = (y1 - y0) / (resource.sampling!.height - 1),
    x = column + (i % width),
    y = row + Math.floor(i / width);
  return [
    Math.max(x0, x0 + (x - 0.5) * dx),
    Math.max(y0, y0 + (y - 0.5) * dy),
    Math.min(x1, x0 + (x + 0.5) * dx),
    Math.min(y1, y0 + (y + 0.5) * dy),
  ];
}
