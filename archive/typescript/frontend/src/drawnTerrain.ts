import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";
import { Fill, Stroke, Style } from "ol/style.js";
import { fieldInterpolator, spatial, MapScale } from "@atlas/domain";
import type { Geometry } from "geojson";
import type { LoadedDrawnMapInput as DrawnMapInput } from "./drawnMap";
import { drawingGeography } from "./drawnGeography";
import type { LoadedRaster as Raster } from "./types";
import { terrainWater } from "./terrainWater";
import { worldFeatureAppearance } from "./worldFeatureAppearance";
import { depictTerrain } from "./terrainDepiction";
export {
  terrainSymbolsAcrossSubject,
  illustratedMountainHeightMetres,
  illustratedReliefMetres,
  illustratedTreeCover,
} from "./terrainDepiction";
export type { TerrainMark } from "./terrainDepiction";
export { illustratedTerrain } from "./illustratedTerrain";

export function terrainMarks(input: DrawnMapInput, footprint: Geometry) {
  return depictTerrain(
    {
      ...input,
      appearance: worldFeatureAppearance(input.world),
      geography: drawingGeography(input.features, input.base),
      samples: terrainSamplers(input),
    },
    footprint
  );
}
function terrainSamplers(input: DrawnMapInput) {
  return input.base
    .slice()
    .reverse()
    .map((raster) => {
      const height = fieldInterpolator(raster.field, "Elevation"),
        water = terrainWater(raster);
      return {
        covers: spatial.pointCoverage(raster.footprint),
        height: (point: Parameters<typeof height>[0]) => MapScale.metres(height(point), "native"),
        water: (point: Parameters<typeof height>[0], metres: number) =>
          water(point, MapScale.native(metres)).kind,
        tree: treeSampler(input.rasters, raster),
      };
    });
}
function treeSampler(rasters: Raster[], base: Raster) {
  const trees = rasters.find(
    (raster) => raster.areaId === base.areaId && raster.channel === "TreeCover"
  );
  return trees ? fieldInterpolator(trees.field, trees.channel) : null;
}
/** Coast echoes are display buffers; the physical shoreline is always the original. */
export function coastEchoes(ocean: Geometry, step: number) {
  return [step * 0.1, step * 0.23].flatMap((distance) => {
    const inner = spatial.buffer(ocean, -distance);
    if (!inner) return [];
    const feature = new Feature({ geometry: new GeoJSON().readGeometry(inner)! });
    feature.setStyle(
      new Style({
        fill: new Fill({ color: "#00000000" }),
        stroke: new Stroke({ color: "#6e938955", width: 0.6 }),
        zIndex: -80,
      })
    );
    return [feature];
  });
}
