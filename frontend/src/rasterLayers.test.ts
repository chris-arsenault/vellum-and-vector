import { expect, it, vi } from "vitest";
import LayerGroup from "ol/layer/Group.js";
import DataTileSource from "ol/source/DataTile.js";
import type WebGLTile from "ol/layer/WebGLTile.js";
import { constructedWorld } from "./constructedWorldFixture";
import { updateRaster } from "./rasterLayers";
import { defaultRasterPresentation } from "./rasterPresentation";
import type { MapEngine } from "./mapEngine";
import type { Raster } from "./types";

it("reuses the OpenLayers terrain layer across map navigation and hides it while inputs change", () => {
  const f = constructedWorld(),
    world = f.source.world,
    field = f.result.state.surface,
    parent: Raster = {
      id: "parent",
      areaId: "parent",
      field,
      channel: "elevation",
      bounds: field.bounds,
      footprint: field.scope.footprint,
    },
    child: Raster = { ...parent, id: "child", areaId: "child" },
    parentSource = new DataTileSource({}),
    childSource = new DataTileSource({}),
    image = new LayerGroup(),
    overlay = new LayerGroup(),
    rasters = {
      begin: vi.fn(),
      end: vi.fn(),
      source: (r: Raster) => (r.id === "parent" ? parentSource : childSource),
    },
    engine = { image, overlay, rasters } as unknown as MapEngine,
    view = defaultRasterPresentation();
  updateRaster(engine, world, [], [parent], view);
  const layer = image.getLayers().item(0) as WebGLTile;
  updateRaster(engine, world, [], [], view);
  expect(image.getLayers().item(0)).toBe(layer);
  expect(layer.getVisible()).toBe(false);
  for (const raster of [child, parent]) {
    updateRaster(engine, world, [], [raster], view);
    expect(image.getLayers().item(0)).toBe(layer);
    expect(layer.getVisible()).toBe(true);
    expect(layer.getSource()).toBe(rasters.source(raster));
  }
  layer.dispose();
  parentSource.dispose();
  childSource.dispose();
});
