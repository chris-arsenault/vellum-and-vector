import { ByteCache, configureSpatial, requireThat, type Bounds } from "@atlas/domain";
import {
  GeometryKernel,
  GeosSpatial,
  OpfsStore,
  ZarrResources,
  openBlockCache,
  FieldInputCache,
} from "@atlas/storage-browser";
import { loadResourceRaster } from "./resourceRaster";
import {
  resourceRaster,
  type Raster,
  type LoadedRaster,
  type RasterGeography,
  type ResourceRaster,
} from "./types";
import type { WorkspaceClient } from "./WorkspaceClient";
import { rasterGeographyKey } from "./rasterIdentity";
import { displayTolerance } from "./sceneWindows";

const geographyCacheBytes = 16 * 1024 * 1024;
/** Tiles along each side of a block that shares one geography read. */
const blockTiles = 8;
/** Pixels of margin around a block, beyond any tile's gutter. */
const blockMargin = 4;

/**
 * The windows of the aligned block of tiles holding a tile, in the chart: a block across a
 * cylindrical world's seam reads both of its sides.
 */
export function tileBlockWindows(extent: number[], resolution: number, wrap?: number[]): Bounds[] {
  const span = resolution * 256 * blockTiles,
    margin = resolution * blockMargin;
  let x = Math.floor((extent[0] + extent[2]) / 2 / span) * span;
  const y = Math.floor((extent[1] + extent[3]) / 2 / span) * span;
  const rows = [y - margin, y + span + margin];
  if (!wrap) return [[x - margin, rows[0], x + span + margin, rows[1]]];
  const [west, east] = wrap,
    width = east - west;
  x = west + ((((x - west) % width) + width) % width);
  const windows: Bounds[] = [
    [Math.max(west, x - margin), rows[0], Math.min(east, x + span + margin), rows[1]],
  ];
  if (x + span + margin > east)
    windows.push([west, rows[0], west + x + span + margin - east, rows[1]]);
  if (x - margin < west) windows.push([east - (west - x + margin), rows[0], east, rows[1]]);
  return windows;
}

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
  const read = async (reference: ResourceRaster["geography"]) => {
    requireThat(
      workspace,
      "renderer_workspace",
      "Connect the renderer to its geographic workspace."
    );
    const key = rasterGeographyKey(reference);
    let shapes = geography.get(key);
    if (!shapes) {
      shapes = await workspace.readRasterGeography(reference);
      geography.set(key, shapes, JSON.stringify(shapes).length * 2);
    }
    return shapes;
  };
  return {
    /**
     * Opens a raster's inputs. A tiled renderer reads sea and lakes per tile instead
     * (`tileGeography`), so its registration does not depend on the viewport.
     */
    async load(raster: Raster, tiled = false): Promise<{ raster: LoadedRaster; close(): void }> {
      if (!resourceRaster(raster)) return { raster, close() {} };
      const shapes =
        raster.channel === "Elevation" && !tiled ? await read(raster.geography) : { lakes: [] };
      const loaded = await loadResourceRaster(store, raster, shapes, inputs);
      const close = () => {
        loaded.close();
        opened.delete(close);
      };
      opened.add(close);
      return { raster: loaded.raster, close };
    },
    /** Sea and lakes of the block of tiles holding one tile, at that tile's scale. */
    tileGeography(raster: ResourceRaster, extent: number[], size: number) {
      const resolution = (extent[2] - extent[0]) / size;
      return read({
        ...raster.geography,
        windows: tileBlockWindows(extent, resolution, raster.wrap),
        tolerance: displayTolerance(resolution),
      });
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
