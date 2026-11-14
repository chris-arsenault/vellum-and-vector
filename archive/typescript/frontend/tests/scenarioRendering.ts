import { updateRaster as renderRaster } from "../src/rasterLayers";
import { updateDrawnMap as renderDrawnMap } from "../src/drawnMap";
export * from "../src/drawnMap";

/** Browser-test aliases intercept drawing only. Field metadata and controls stay real. */
export function updateRaster(...args: Parameters<typeof renderRaster>) {
  if (window.atlasScenario?.rendering !== false) renderRaster(...args);
}

const noFields: Parameters<typeof renderDrawnMap>[1]["base"] = [];
export function updateDrawnMap(...[engine, input]: Parameters<typeof renderDrawnMap>) {
  renderDrawnMap(
    engine,
    window.atlasScenario?.rendering === false
      ? { ...input, base: noFields, rasters: noFields }
      : input
  );
}
