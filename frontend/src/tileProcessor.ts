import type { GridSurface } from "@atlas/domain";
import { numericTileSampler } from "./numericTiles";
import type { TileMessage, TileReply } from "./tileProtocol";
import { terrainTile } from "./terrainTile";
function rasterSampler(
  r: Extract<TileMessage, { kind: "raster" }>["raster"],
  grids: Map<number, GridSurface>
) {
  const sample = numericTileSampler({
    ...r,
    field: grids.get(r.field)!,
    water: r.water === undefined ? undefined : grids.get(r.water),
    ice: r.ice === undefined ? undefined : grids.get(r.ice),
  });
  return (extent: number[], size: number) =>
    r.channel === "elevation" ? terrainTile(sample(extent, size), size) : sample(extent, size);
}

/** Worker-owned evaluators share registered grids and never mutate session arrays. */
export function tileProcessor() {
  const grids = new Map<number, GridSurface>();
  const samplers = new Map<number, ReturnType<typeof rasterSampler>>();
  return (message: TileMessage): TileReply | null => {
    if (message.kind === "grid") grids.set(message.id, message.grid);
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
      return { request: message.request, values: sample(message.extent, message.size) };
    } catch (error) {
      return {
        request: message.request,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
