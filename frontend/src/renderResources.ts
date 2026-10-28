import { ByteCache, configureSpatial, requireThat } from "@atlas/domain";
import {
  GeometryKernel,
  GeosSpatial,
  OpfsStore,
  ZarrResources,
  openBlockCache,
  FieldInputCache,
} from "@atlas/storage-browser";
import { loadResourceRaster } from "./resourceRaster";
import { resourceRaster, type Raster, type LoadedRaster, type RasterGeography } from "./types";
import type { WorkspaceClient } from "./WorkspaceClient";
import { rasterGeographyKey } from "./rasterIdentity";

const geographyCacheBytes = 16 * 1024 * 1024;

/** Each renderer owns one bounded working cache and releases its files before closing. */
export async function openRenderResources(
  workspace?: Pick<WorkspaceClient, "readRasterGeography">
) {
  const kernel = await GeometryKernel.create();
  configureSpatial((precision) => new GeosSpatial(kernel, precision));
  let working: Awaited<ReturnType<typeof openBlockCache>>;
  let store: ZarrResources;
  try {
    store = new ZarrResources(await OpfsStore.open("atlas-resources"));
    working = await openBlockCache(`render_${crypto.randomUUID()}`);
  } catch (error) {
    configureSpatial();
    kernel.close();
    throw error;
  }
  const opened = new Set<() => void>();
  const geography = new ByteCache<string, RasterGeography>(geographyCacheBytes);
  const inputs = new FieldInputCache(store, working.cache);
  return {
    async load(raster: Raster): Promise<{ raster: LoadedRaster; close(): void }> {
      if (!resourceRaster(raster)) return { raster, close() {} };
      requireThat(
        workspace,
        "renderer_workspace",
        "Connect the renderer to its geographic workspace."
      );
      const key = rasterGeographyKey(raster.geography);
      let shapes = raster.channel === "elevation" ? geography.get(key) : { lakes: [] };
      if (!shapes) {
        shapes = await workspace.readRasterGeography(raster.geography);
        geography.set(key, shapes, JSON.stringify(shapes).length * 2);
      }
      const loaded = await loadResourceRaster(store, raster, shapes, inputs);
      const close = () => {
        loaded.close();
        opened.delete(close);
      };
      opened.add(close);
      return { raster: loaded.raster, close };
    },
    async close() {
      try {
        try {
          for (const close of opened) close();
        } finally {
          await working.close();
        }
      } finally {
        geography.clear();
        configureSpatial();
        kernel.close();
      }
    },
  };
}
