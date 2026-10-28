import OLMap from "ol/Map.js";
import View from "ol/View.js";
import Projection from "ol/proj/Projection.js";
import WebGLTile from "ol/layer/WebGLTile.js";
import { createGrid, generateBand, gridPosition, putChannel, rectangle } from "@atlas/domain";
import { numericTileSampler, numericTileSource } from "../src/numericTiles";
import { terrainTile } from "../src/terrainTile";
import { terrainStyle } from "../src/rasterStyles";
import { configureTerrainContours } from "../src/terrainContours";
import { defaultRasterPresentation } from "../src/rasterPresentation";
import type { LoadedRaster as Raster, RasterPresentation } from "../src/types";
import { openSpatialRuntime } from "../src/spatialRuntime";

const spatialReady = openSpatialRuntime();

interface MountainOptions {
  resolution: number;
  ice?: number;
  exaggeration?: number;
  base?: RasterPresentation["base"];
  interval?: number;
  shape?: "mountain" | "slope";
  center?: [number, number];
}

function terrain(options: MountainOptions): Raster {
  const field = createGrid(
    "mountain",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "mountain",
      footprint: rectangle([0, 0, 100_000, 100_000]),
      revision: 1,
      resolution: null,
      time: "present",
    },
    17,
    17
  );
  putChannel(
    field,
    "elevation",
    "metre",
    generateBand(field.coverage, "float64", "elevation", (i) => {
      const { x, y } = gridPosition(field, i);
      if (options.shape === "slope") return 1000 + x * 0.1;
      const ridge = 50_000 + 7000 * Math.sin(y / 16_000);
      return (
        1000 +
        6500 * Math.exp(-(((x - ridge) / 12_000) ** 2)) +
        800 * Math.exp(-((x - 75_000) ** 2 + (y - 30_000) ** 2) / 15_000 ** 2)
      );
    })
  );
  putChannel(
    field,
    "ice",
    "ratio",
    generateBand(field.coverage, "float64", "ice", () => options.ice ?? 0)
  );
  return {
    id: field.id,
    areaId: "area",
    field,
    channel: "elevation",
    footprint: field.scope.footprint,
    bounds: field.bounds,
    ice: field,
  };
}

function pixelReader(layer: WebGLTile, map: OLMap) {
  let pixels = new Uint8Array(),
    width = 0,
    height = 0;
  layer.on("postrender", (event) => {
    const gl = event.context as WebGLRenderingContext;
    width = gl.drawingBufferWidth;
    height = gl.drawingBufferHeight;
    pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  });
  return (x: number, y: number) => {
    const [px, py] = map.getPixelFromCoordinate([x, y]),
      size = map.getSize()!;
    const col = Math.floor((px * width) / size[0]),
      row = height - 1 - Math.floor((py * height) / size[1]);
    const at = (row * width + col) * 4;
    return [...pixels.slice(at, at + 4)];
  };
}

function fixture() {
  document.body.innerHTML =
    '<div id="mountain-fixture" style="width:640px;height:640px;position:relative"></div>';
  const projection = new Projection({
    code: "mountain",
    units: "m",
    extent: [0, 0, 100_000, 100_000],
  });
  const layer = new WebGLTile();
  const map = new OLMap({
    target: "mountain-fixture",
    layers: [layer],
    controls: [],
    interactions: [],
    view: new View({ projection, center: [50_000, 50_000], resolution: 100 }),
  });
  const color = pixelReader(layer, map);
  return {
    async render(options: MountainOptions) {
      await spatialReady;
      const raster = terrain(options),
        sample = numericTileSampler(raster);
      const view: RasterPresentation = {
        ...defaultRasterPresentation(),
        base: options.base ?? "topographic",
        exaggeration: options.exaggeration ?? 1,
        contourInterval: options.interval ?? 100,
        sunElevation: 90,
      };
      layer.setStyle(terrainStyle(view));
      configureTerrainContours(layer, view.contourInterval);
      map.getView().setResolution(options.resolution);
      map.getView().setCenter(options.center ?? [50_000, 50_000]);
      const previous = layer.getSource();
      const rendered = new Promise<void>((resolve) => map.once("rendercomplete", () => resolve()));
      layer.setSource(
        numericTileSource(
          raster,
          projection,
          async (extent, size) => terrainTile(sample(extent, size), size),
          1
        )
      );
      previous?.dispose();
      map.render();
      await rendered;
    },
    async zoom(resolution: number) {
      const rendered = new Promise<void>((resolve) => map.once("rendercomplete", () => resolve()));
      map.getView().setResolution(resolution);
      map.render();
      await rendered;
    },
    scale() {
      return { resolution: layer.get("contourResolution"), minimum: layer.get("contourMinimum") };
    },
    color,
    dispose() {
      map.dispose();
    },
  };
}

declare global {
  interface Window {
    mountainRendering: ReturnType<typeof fixture>;
  }
}
window.mountainRendering = fixture();
