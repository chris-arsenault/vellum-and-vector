import OLMap from "ol/Map.js";
import View from "ol/View.js";
import Projection from "ol/proj/Projection.js";
import WebGLTile from "ol/layer/WebGLTile.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import { Stroke, Style } from "ol/style.js";
import {
  createGrid,
  generateBand,
  putChannel,
  rectangle,
  surfaceCode,
  surfaceCategories,
  classMarginInterpolator,
  fieldContour,
  spatial,
} from "@atlas/domain";
import { numericTileSampler, numericTileSource } from "../src/numericTiles";
import { terrainTile } from "../src/terrainTile";
import { terrainStyle } from "../src/rasterStyles";
import { defaultRasterPresentation } from "../src/rasterPresentation";
import { openSpatialRuntime } from "../src/spatialRuntime";

const ready = openSpatialRuntime();
function suppliedTerrain() {
  const bounds = [0, 0, 600_000, 600_000],
    footprint = rectangle(bounds as [number, number, number, number]),
    field = createGrid(
      "cover",
      {
        worldId: "world",
        areaId: "area",
        spaceId: "surface",
        crsId: "cover",
        footprint,
        revision: 1,
        resolution: null,
        time: "present",
      },
      16,
      16
    ),
    forestCode = surfaceCode("Temperate forest"),
    plainCode = surfaceCode("Grassland");
  putChannel(
    field,
    "elevation",
    "metre",
    generateBand(field.coverage, "float64", "elevation", () => 1000)
  );
  for (const channel of ["naturalSurface", "finalSurface"])
    putChannel(
      field,
      channel,
      "category",
      generateBand(field.coverage, "float64", channel, (i) =>
        i % 16 < 8 ? plainCode : forestCode
      ),
      "category"
    );
  const margin = classMarginInterpolator(field, "finalSurface", (code) => code === forestCode),
    shape = fieldContour(field, (x, y) => margin({ x, y, z: 0 }), undefined, 0)!,
    raster = {
      id: "cover",
      areaId: "area",
      field,
      surface: field,
      channel: "elevation",
      footprint,
      bounds: field.bounds,
    },
    sample = numericTileSampler(raster);
  return { bounds, forestCode, shape, raster, sample };
}
async function fixture() {
  await ready;
  document.body.innerHTML =
    '<div id="ecology-fixture" style="width:512px;height:512px;position:relative"></div>';
  const { bounds, forestCode, shape, raster, sample } = suppliedTerrain(),
    projection = new Projection({ code: "cover", units: "m", extent: bounds }),
    layer = new WebGLTile({
      source: numericTileSource(
        raster,
        projection,
        async (extent, size) => terrainTile(sample(extent, size), size),
        1
      ),
    }),
    outline = new VectorLayer({
      source: new VectorSource({ features: [new Feature(new GeoJSON().readGeometry(shape)!)] }),
      style: new Style({ stroke: new Stroke({ color: "#ff00ff", width: 1 }) }),
    }),
    map = new OLMap({
      target: "ecology-fixture",
      controls: [],
      interactions: [],
      layers: [layer, outline],
      view: new View({ projection, center: [300_000, 300_000], resolution: 600_000 / 512 }),
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
    async render(zoom: number, sun: number, alternate: boolean) {
      const palette = surfaceCategories().map((c) =>
          alternate && c.code === forestCode ? { ...c, color: "#156b28" } : c
        ),
        view = { ...defaultRasterPresentation(), sunElevation: sun, contourInterval: 100_000 };
      const done = new Promise<void>((resolve) => map.once("rendercomplete", () => resolve()));
      layer.setStyle(terrainStyle(view, palette));
      map.getView().setResolution(600_000 / 512 / zoom);
      map.render();
      await done;
    },
    edge() {
      const color = (x: number) => {
        const [px, py] = map.getPixelFromCoordinate([x, 300_000]),
          size = map.getSize()!,
          at =
            ((height - 1 - Math.floor((py * height) / size[1])) * width +
              Math.floor((px * width) / size[0])) *
            4;
        return [...pixels.slice(at, at + 3)];
      };
      const left = color(280_000),
        right = color(320_000),
        distance = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
      return {
        border: spatial.bounds(shape)[0],
        contrast: distance(left, right),
        classes: [296_000, 298_000, 302_000, 304_000].map(
          (x) => distance(color(x), right) < distance(color(x), left)
        ),
      };
    },
    dispose() {
      map.dispose();
    },
  };
}
declare global {
  interface Window {
    worldEcologyRendering: ReturnType<typeof fixture>;
  }
}
window.worldEcologyRendering = fixture();
