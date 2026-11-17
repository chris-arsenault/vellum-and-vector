import Map from "ol/Map.js";
import View from "ol/View.js";
import Projection from "ol/proj/Projection.js";
import { writeArrayBuffer } from "geotiff";
import type { MapLayer } from "@atlas/map";
import type { RasterPresentation } from "../src/types";
import { publishedRaster } from "../src/publishedRaster";

/** Explicit GIS pixels straddle a tile edge; no numerical world or generator is involved. */
export async function publishedRasterEdge(input: MapLayer, settings: RasterPresentation) {
  const layer = structuredClone(input);
  if (layer.source.kind !== "raster") throw new Error("Expected supplied terrain.");
  const raster = layer.source.data;
  const ids = raster.bands.map((band) => band.id);
  raster.bandIndices = ids.map((_, i) => i + 1);
  const pixels = new Float32Array(512 * 16 * ids.length);
  for (let tile = 0; tile < 2; tile++) {
    const values: Record<string, number> = {
      value: 123,
      "relative-height": 123,
      "display-height": 123,
      "sample-span": 1,
      "paint-red": tile ? 192 : 32,
      "paint-green": tile ? 64 : 128,
      "paint-blue": tile ? 32 : 64,
      "paint-alpha": 1,
      coverage: 1,
    };
    for (let i = 0; i < 256 * 16; i++)
      ids.forEach((id, band) => {
        pixels[(tile * 256 * 16 + i) * ids.length + band] = values[id] ?? 0;
      });
  }
  const bytes = writeArrayBuffer(pixels, {
    width: 512,
    height: 16,
    SamplesPerPixel: ids.length,
    TileWidth: 256,
    TileLength: 16,
    TileByteCounts: [pixels.byteLength / 2, pixels.byteLength / 2],
    ModelPixelScale: [1, 1, 0],
    ModelTiepoint: [0, 0, 0, 0, 16, 0],
    ProjectedCSTypeGeoKey: 32767,
    GTModelTypeGeoKey: 1,
  });
  const url = URL.createObjectURL(new Blob([bytes]));
  const target = document.createElement("div");
  target.style.cssText = "width:512px;height:64px";
  document.body.append(target);
  const projection = new Projection({ code: "seam-fixture", units: "m", extent: [0, 0, 512, 16] });
  const terrain = publishedRaster(layer, { url, mediaType: "image/tiff" }, projection, settings);
  const map = new Map({
    target,
    layers: [terrain],
    pixelRatio: 1,
    view: new View({ projection, center: [256, 8], resolution: 0.125 }),
  });
  try {
    return await new Promise<number[]>((resolve) => {
      terrain.on("postrender", (event) => {
        const gl = event.context as WebGLRenderingContext;
        const sample = new Uint8Array(8);
        gl.readPixels(255, 32, 2, 1, gl.RGBA, gl.UNSIGNED_BYTE, sample);
        if (sample[3] && sample[7]) resolve([...sample]);
      });
    });
  } finally {
    map.dispose();
    terrain.dispose();
    target.remove();
    URL.revokeObjectURL(url);
  }
}
