import type Projection from "ol/proj/Projection.js";
import type DataTileSource from "ol/source/DataTile.js";
import type { Raster } from "./types";
import { numericTileSource } from "./numericTiles";
import { TileWorkerClient } from "./TileWorkerClient";
import type { GridSurface } from "@atlas/domain";

function sameGrid(a?: GridSurface, b?: GridSurface): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const inputs = ["active", "bounds", "topology", "ocean", "overlays", "reconstruction"] as const;
  const channels = Object.keys(a.channels);
  return (
    inputs.every((key) => a[key] === b[key]) &&
    a.scope.footprint === b.scope.footprint &&
    channels.length === Object.keys(b.channels).length &&
    channels.every((channel) => a.channels[channel] === b.channels[channel]) &&
    JSON.stringify([a.width, a.height, a.units, a.quantities ?? {}]) ===
      JSON.stringify([b.width, b.height, b.units, b.quantities ?? {}])
  );
}
function sameData(a: Raster, b: Raster) {
  return (
    sameGrid(a.field, b.field) &&
    sameGrid(a.water, b.water) &&
    sameGrid(a.ice, b.ice) &&
    JSON.stringify(a.lakes) === JSON.stringify(b.lakes) &&
    a.footprint === b.footprint
  );
}
export class RasterSources {
  private sources = new Map<
    string,
    { source: DataTileSource; raster: Raster; registration: number }
  >();
  private used = new Set<string>();
  constructor(
    private projection: Projection,
    private client = new TileWorkerClient()
  ) {}
  begin() {
    this.used.clear();
  }
  source(raster: Raster) {
    const key = `${raster.id}:${raster.channel}`;
    this.used.add(key);
    let entry = this.sources.get(key);
    if (entry && !sameData(entry.raster, raster)) {
      this.release(key);
      entry = undefined;
    }
    if (!entry) {
      const registration = this.client.register(raster);
      const source = numericTileSource(raster, this.projection, (extent, size, signal) =>
        this.client.load(registration, extent, size, signal)
      );
      entry = { source, raster, registration };
      this.sources.set(key, entry);
    }
    return entry.source;
  }
  private release(key: string) {
    const entry = this.sources.get(key)!;
    this.client.release(entry.registration);
    entry.source.dispose();
    this.sources.delete(key);
  }
  end() {
    for (const key of this.sources.keys()) if (!this.used.has(key)) this.release(key);
  }
  dispose() {
    this.client.dispose();
    for (const e of this.sources.values()) e.source.dispose();
    this.sources.clear();
  }
}
