import {
  areaDepth,
  isDescendant,
  spatial,
  type FieldPatch,
  type ResourceStore,
  type World,
} from "@atlas/domain";
import { mergeSummary, resourceCategories } from "@atlas/storage-browser";
import type { Geometry } from "geojson";
import type { FieldReference, ResourceRaster } from "./types";

export function mappedPatches(
  world: World,
  areaId: string,
  fieldId: string,
  patches: FieldPatch[]
) {
  return patches
    .filter(
      (patch) =>
        patch.fieldId === fieldId &&
        (!patch.mapOnly || isDescendant(world.areas, areaId, patch.areaId))
    )
    .sort(
      (a, b) =>
        Number(!!a.mapOnly) - Number(!!b.mapOnly) ||
        areaDepth(world.areas, a.areaId) - areaDepth(world.areas, b.areaId)
    );
}
export async function patchRanges(store: ResourceStore, reference: FieldReference) {
  for (const patch of reference.patches) {
    const resource = await store.describe(patch.resourceId);
    for (const channel of patch.channels) {
      const summary = resource.field?.summaries?.[channel];
      if (summary)
        reference.channels[channel] = reference.channels[channel]
          ? mergeSummary(reference.channels[channel], summary)
          : summary;
    }
  }
}
/** Match composed field visibility: finer fields and later patches cover earlier samples. */
export async function rasterCategorySummaries(store: ResourceStore, rasters: ResourceRaster[]) {
  const covered = new Map<string, Geometry>();
  for (const raster of rasters.slice().reverse()) {
    const reference = raster.field,
      channel = raster.channel;
    if (reference.quantities[channel] !== "category") continue;
    const previous = covered.get(channel),
      visible = previous ? spatial.difference(raster.footprint, previous) : raster.footprint;
    const categories = visible ? await composedCategories(store, reference, channel, visible) : [];
    raster.field = {
      ...reference,
      channels: {
        ...reference.channels,
        [channel]: { range: reference.channels[channel]?.range ?? [0, 1], categories },
      },
    };
    covered.set(channel, previous ? spatial.union(previous, raster.footprint) : raster.footprint);
  }
}
async function composedCategories(
  store: ResourceStore,
  reference: FieldReference,
  channel: string,
  footprint: Geometry
) {
  const categories = new Set<number>();
  let remaining: Geometry | null = footprint;
  const inputs = [{ resourceId: reference.resourceId, channels: [channel] }, ...reference.patches];
  for (const input of inputs.reverse()) {
    if (!remaining) break;
    if (!input.channels.includes(channel)) continue;
    const resource = await store.describe(input.resourceId),
      scope = resource.field!.scope;
    const visible = spatial.intersection(remaining, scope.footprint);
    if (visible)
      for (const code of await resourceCategories(store, resource, channel, visible))
        categories.add(code);
    remaining = spatial.difference(remaining, scope.footprint);
  }
  return [...categories].sort((a, b) => a - b);
}
