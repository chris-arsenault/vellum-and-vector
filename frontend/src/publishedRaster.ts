import GeoTIFF from "ol/source/GeoTIFF.js";
import WebGLTile from "ol/layer/WebGLTile.js";
import type Projection from "ol/proj/Projection.js";
import {
  terrainBands,
  terrainLayerId,
  type MapAssetSource,
  type MapLayer,
  type Category,
  type RasterSource,
} from "@atlas/map";
import type { FieldStyle, RasterPresentation } from "./types";
import { overlayStyle, terrainStyle } from "./rasterStyles";
import { configureTerrainContours } from "./terrainContours";

/** Source band selection adapts standard map assets to the existing GPU appearance controls. */
export function publishedRaster(
  layer: MapLayer,
  asset: MapAssetSource,
  projection: Projection,
  presentation: RasterPresentation,
  overlay?: FieldStyle
) {
  if (layer.source.kind !== "raster") throw new Error("Choose a published raster layer.");
  const raster = layer.source.data;
  const terrain = layer.id === terrainLayerId && !overlay;
  const ids = terrain
    ? [terrainBands[0], "coverage", ...terrainBands.slice(1)]
    : ["value", "coverage", "log-value"];
  const bands = ids.map((id) => {
    const index = raster.bands.findIndex((band) => band.id === id);
    if (index < 0) throw new Error(`Map layer ${layer.id} is missing its ${id} band.`);
    return raster.bandIndices[index];
  });
  const value = raster.bands[0];
  const style = publishedStyle(raster, terrain, presentation, overlay);
  const source = new GeoTIFF({
    sources: [{ url: asset.url, bands }],
    projection,
    normalize: false,
    convertToRGB: false,
    interpolate: terrain || (value.unit !== "category" && !value.categories.length),
    wrapX: projection.canWrapX(),
    transition: 0,
  });
  const result = new WebGLTile({
    source,
    style,
    opacity: terrain ? 1 : overlay!.opacity,
    properties: { mapLayerId: layer.id },
  });
  if (terrain) configureTerrainContours(result, presentation.contourInterval);
  return result;
}
export function publishedStyle(
  raster: RasterSource,
  terrain: boolean,
  presentation: RasterPresentation,
  overlay?: FieldStyle
) {
  const value = raster.bands[0];
  const categories =
    (terrain ? raster.bands.find((band) => band.id === "surface") : value)?.categories ?? [];
  const classes = surfaceClasses(categories);
  if (terrain) return terrainStyle(presentation);
  if (!overlay) throw new Error("Choose appearance settings for the map overlay.");
  return overlayStyle(
    overlay,
    overlay.range ?? value.range ?? [0, 1],
    classes.length ? classes : null
  );
}
function surfaceClasses(categories: Category[]) {
  return categories.flatMap((category) =>
    category.color
      ? [
          {
            code: category.value,
            name: category.label,
            color: category.color,
            bathymetric: category.surface?.bathymetric ?? false,
            tint: category.surface?.tint ?? 1,
            system: category.surface?.system ?? undefined,
          },
        ]
      : []
  );
}
