import { fieldContour, fieldInterpolator, spatial, type GridSurface } from "@atlas/domain";
import type { Geometry } from "geojson";
import { resourceRaster, type Raster, type LoadedRaster } from "./types";

const oceans = new WeakMap<GridSurface, { water: Raster["water"]; geometry: Geometry | null }>();
/** Existing shorelines retain authority; scalar-only maps use the shared contour operation. */
export function drawnOcean(raster: Raster): Geometry | null {
  if (resourceRaster(raster)) return null;
  const previous = oceans.get(raster.field);
  if (previous && previous.water === raster.water) return previous.geometry;
  let ocean =
    raster.field.ocean === undefined ? contourSea(raster, raster.field) : raster.field.ocean;
  for (const edit of raster.field.overlays ?? []) {
    if (!edit.channels.includes("elevation")) continue;
    const retained = ocean ? spatial.difference(ocean, edit.grid.scope.footprint) : null;
    const changed = contourSea(raster, edit.grid);
    ocean = spatial.unionAll([retained, changed].filter((g): g is Geometry => !!g));
  }
  oceans.set(raster.field, { water: raster.water, geometry: ocean });
  return ocean;
}
function contourSea(raster: LoadedRaster, grid: GridSurface) {
  const height = fieldInterpolator(grid, "elevation");
  const level = raster.water?.channels.seaLevel
    ? fieldInterpolator(raster.water, "seaLevel")
    : () => 0;
  const at = (x: number, y: number) => {
    const p = { x, y, z: 0 };
    return level(p) - height(p);
  };
  const shape = fieldContour(grid.topology ?? grid, at, undefined, 0);
  return shape ? spatial.intersection(shape, grid.scope.footprint) : null;
}
