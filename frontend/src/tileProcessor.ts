import { attachGrid, type GridSurface } from "@atlas/domain";
import { numericTileSampler } from "./numericTiles";
import type { TileMessage, TileReply } from "./tileProtocol";
import { terrainTile } from "./terrainTile";
import type { LoadedRaster } from "./types";
function rasterSampler(
  r: Extract<TileMessage, { kind: "raster" }>["raster"],
  grids: Map<number, GridSurface>
) {
  const sample = numericTileSampler({
    ...r,
    field: grids.get(r.field)!,
    water: r.water === undefined ? undefined : grids.get(r.water),
    ice: r.ice === undefined ? undefined : grids.get(r.ice),
    surface: r.surface === undefined ? undefined : grids.get(r.surface),
  });
  return terrainOrValues(r.channel, sample);
}
type Sample = ReturnType<typeof numericTileSampler>;
/** Terrain tiles add their relief gradients; other channels return their samples. */
function terrainOrValues(channel: string, sample: Sample): Sample {
  return (extent, size, own) =>
    channel === "elevation"
      ? terrainTile(sample(extent, size, own), size)
      : sample(extent, size, own);
}

/** Worker-owned evaluators share registered grids and never mutate session arrays. */
export function tileProcessor() {
  const grids = new Map<number, GridSurface>();
  const samplers = new Map<number, ReturnType<typeof rasterSampler>>();
  return (
    message: TileMessage | { kind: "loadedRaster"; id: number; raster: LoadedRaster }
  ): Exclude<TileReply, { kind: string }> | null => {
    if (message.kind === "loadedRaster")
      samplers.set(
        message.id,
        terrainOrValues(message.raster.channel, numericTileSampler(message.raster))
      );
    if (message.kind === "grid") grids.set(message.id, attachGrid(message.grid));
    if (message.kind === "raster") {
      samplers.set(message.id, rasterSampler(message.raster, grids));
    }
    if (message.kind === "release") {
      samplers.delete(message.id);
      for (const id of message.grids) grids.delete(id);
    }
    if (message.kind !== "tile") return null;
    try {
      const sample = samplers.get(message.id);
      if (!sample) throw new Error("Raster source was released.");
      return {
        request: message.request,
        values: sample(message.extent, message.size, message.geography),
      };
    } catch (error) {
      return {
        request: message.request,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
