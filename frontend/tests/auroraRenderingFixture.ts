import OLMap from "ol/Map.js";
import View from "ol/View.js";
import Projection from "ol/proj/Projection.js";
import WebGLTile from "ol/layer/WebGLTile.js";
import {
  createGrid,
  putChannel,
  rectangle,
  surfaceCode,
  surfaceCategories,
  magicSurfaceCode,
  canonryMagicPresets,
} from "@atlas/domain";
import { numericTileSampler, numericTileSource } from "../src/numericTiles";
import { terrainTile } from "../src/terrainTile";
import { terrainStyle } from "../src/rasterStyles";
import { defaultRasterPresentation } from "../src/rasterPresentation";
import type { Raster } from "../src/types";

export interface RenderingOptions {
  ice?: number;
  magic?: boolean;
  shape?: "flat" | "ridge" | "slope";
  contours?: boolean;
}

function fixture() {
  document.body.innerHTML =
    '<div id="aurora-fixture" style="width:512px;height:512px;position:relative"></div>';
  const projection = new Projection({
    code: "aurora-rendering",
    units: "m",
    extent: [0, 0, 1000, 1000],
  });
  const layer = new WebGLTile();
  const map = new OLMap({
    target: "aurora-fixture",
    layers: [layer],
    controls: [],
    interactions: [],
    view: new View({ projection, center: [500, 500], resolution: 1000 / 512 }),
  });
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
  return {
    async render(options: RenderingOptions) {
      const raster = terrain(options),
        sample = numericTileSampler(raster);
      const view = defaultRasterPresentation();
      if (!options.contours) view.base = options.shape === "ridge" ? "relief" : "surface";
      view.contourInterval = options.contours ? 50 : 100_000;
      view.sunElevation = options.shape === "ridge" ? 35 : 90;
      layer.setStyle(terrainStyle(view, surfaceCategories(canonryMagicPresets())));
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
    color(x: number, y: number) {
      const [px, py] = map.getPixelFromCoordinate([x, y]);
      const size = map.getSize()!;
      const col = Math.floor((px * width) / size[0]),
        row = height - 1 - Math.floor((py * height) / size[1]);
      const at = (row * width + col) * 4;
      return [...pixels.slice(at, at + 4)];
    },
    dispose() {
      map.dispose();
    },
  };
}

function terrain(options: RenderingOptions): Raster {
  const field = createGrid(
    "aurora-rendering",
    {
      worldId: "world",
      areaId: "area",
      spaceId: "surface",
      crsId: "aurora-rendering",
      footprint: rectangle([0, 0, 1000, 1000]),
      revision: 1,
      resolution: null,
      time: "present",
    },
    33,
    33
  );
  const count = field.active.length;
  putChannel(
    field,
    "elevation",
    "metre",
    Float64Array.from({ length: count }, (_, i) => {
      const x = ((i % 33) * 1000) / 32;
      return (
        1000 +
        (options.shape === "ridge" ? Math.abs(x - 500) : options.shape === "slope" ? x / 2 : 0)
      );
    })
  );
  putChannel(field, "ice", "ratio", new Float64Array(count).fill(options.ice ?? 0));
  const natural = Float64Array.from({ length: count }, (_, i) =>
    surfaceCode(i % 33 < 16 ? "Boreal forest" : "Scree field")
  );
  putChannel(field, "naturalSurface", "category", natural, "category");
  putChannel(
    field,
    "finalSurface",
    "category",
    options.magic === false
      ? natural.slice()
      : new Float64Array(count).fill(magicSurfaceCode(canonryMagicPresets(), "aurora", "field")!),
    "category"
  );
  return {
    id: field.id,
    areaId: "area",
    field,
    channel: "elevation",
    footprint: field.scope.footprint,
    bounds: field.bounds,
    ice: field,
    surface: field,
  };
}

declare global {
  interface Window {
    auroraRendering: ReturnType<typeof fixture>;
  }
}
window.auroraRendering = fixture();
