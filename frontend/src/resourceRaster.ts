import { overlayField, type Grid } from "@atlas/domain";
import {
  FieldWorkingSet,
  type FieldInputStore,
  type FieldInputCache,
} from "@atlas/storage-browser";
import type { FieldReference, LoadedRaster, ResourceRaster, RasterGeography } from "./types";

/** A rendering operation opens immutable chunks directly; no samples cross the UI boundary. */
export async function loadResourceRaster(
  store: FieldInputStore,
  raster: ResourceRaster,
  geography: RasterGeography,
  inputs: FieldInputCache
) {
  const working = new FieldWorkingSet(store, inputs.blocks, inputs);
  async function field(
    reference: FieldReference | undefined,
    names: string[]
  ): Promise<Grid | undefined> {
    if (!reference) return;
    const resource = await store.describe(reference.resourceId),
      descriptor = resource.field!;
    const grid = await working.load(
      resource.id,
      names.filter((name) => name in descriptor.channels),
      {
        id: descriptor.geographyId,
        scope: resource.scope,
        ocean: reference === raster.field ? geography.ocean : undefined,
      }
    );
    for (const patch of reference.patches) {
      const selected = patch.channels.filter((name) => names.includes(name));
      if (!selected.length) continue;
      const description = await store.describe(patch.resourceId);
      const overlay = await working.load(patch.resourceId, selected, {
        id: description.field!.geographyId,
        scope: description.scope,
      });
      overlayField(grid, overlay, selected, patch.mapOnly);
    }
    return grid;
  }
  try {
    const loaded: LoadedRaster = {
      ...raster,
      field: (await field(raster.field, [raster.channel]))!,
      water: await field(raster.water, ["water", "seaLevel"]),
      ice: await field(raster.ice, ["ice"]),
      surface: await field(raster.surface, ["finalSurface", "secondSurface", "naturalSurface"]),
      lakes: raster.channel === "elevation" ? geography.lakes : undefined,
    };
    return { raster: loaded, close: () => working.close() };
  } catch (error) {
    working.close();
    throw error;
  }
}
