import { fromUrl, type GeoTIFF, type TypedArrayArrayWithDimensions } from "geotiff";
import {
  mapSpace,
  mapPosition,
  type Bounds,
  type MapDescriptor,
  type MapLayer,
  type MapReader,
  type ReadOptions,
} from "@atlas/map";
import { publishedWindows } from "./publishedScene";
import { rasterSample, type RasterSamples } from "./mapRasterSamples";

type Point = { x: number; y: number };
export interface PublishedSampleWindow {
  covers(point: Point): boolean;
  at(band: string, point: Point, categorical?: boolean): number;
}
/** Illustration reads map TIFF windows and overviews, never private numerical resources. */
export class PublishedSamples {
  private readonly files = new Map<string, Promise<GeoTIFF>>();
  private readonly abort = new AbortController();
  constructor(
    private readonly reader: MapReader,
    private readonly map: MapDescriptor
  ) {}

  async read(
    layer: MapLayer,
    bands: string[],
    extent: Bounds,
    spacing: number,
    options?: ReadOptions
  ): Promise<PublishedSampleWindow[]> {
    if (layer.source.kind !== "raster")
      throw new Error("Illustration samples require a map raster.");
    const signal = options?.signal
      ? AbortSignal.any([this.abort.signal, options.signal])
      : this.abort.signal;
    signal.throwIfAborted();
    const source = layer.source.data,
      names = [...new Set([...bands, "coverage"])];
    const samples = names.map((id) => {
      const index = source.bands.findIndex((band) => band.id === id);
      if (index < 0) throw new Error(`Map raster ${layer.id} is missing ${id}.`);
      return index;
    });
    const tiff = await this.open(source.assetId);
    const space = mapSpace(this.map, layer.spaceId);
    const windows = publishedWindows(space, extent)
      .map((window) => intersect(window, layer.bounds))
      .filter((window): window is Bounds => !!window);
    return Promise.all(
      windows.map(async (bounds) => {
        const width = Math.max(1, Math.ceil((bounds[2] - bounds[0]) / spacing));
        const height = Math.max(1, Math.ceil((bounds[3] - bounds[1]) / spacing));
        const values = (await tiff.readRasters({
          bbox: bounds,
          samples,
          width,
          height,
          interleave: false,
          resampleMethod: "nearest",
          signal,
        })) as TypedArrayArrayWithDimensions;
        const data: RasterSamples = { bounds, width, height, bands: names, values };
        const point = (p: Point) => mapPosition(space, [p.x, p.y]);
        return {
          covers: (p: Point) => {
            const [x, y] = point(p);
            return (
              x >= bounds[0] &&
              x <= bounds[2] &&
              y >= bounds[1] &&
              y <= bounds[3] &&
              rasterSample(data, "coverage", x, y, true) > 0.99
            );
          },
          at: (band: string, p: Point, categorical = false) => {
            const [x, y] = point(p);
            return rasterSample(data, band, x, y, categorical);
          },
        };
      })
    );
  }
  private open(assetId: string) {
    let file = this.files.get(assetId);
    if (!file) {
      file = this.reader
        .source(this.map.reference, assetId, { signal: this.abort.signal })
        .then((source) => fromUrl(source.url, {}, this.abort.signal));
      this.files.set(assetId, file);
      void file.catch(() => this.files.delete(assetId));
    }
    return file;
  }
  async close() {
    this.abort.abort();
    await Promise.allSettled([...this.files.values()].map(async (file) => (await file).close()));
    this.files.clear();
  }
}
function intersect(a: Bounds, b: Bounds): Bounds | null {
  const box: Bounds = [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
  return box[2] > box[0] && box[3] > box[1] ? box : null;
}
