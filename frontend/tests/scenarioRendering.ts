import { PublishedMapLayers as RasterLayers } from "../src/PublishedMapLayers";

/** Metadata and interactions stay real; raster work is opt-in for visual assertions. */
export class PublishedMapLayers extends RasterLayers {
  override async update(...args: Parameters<RasterLayers["update"]>) {
    if (window.atlasScenario?.rendering !== false) await super.update(...args);
  }
}
