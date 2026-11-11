import {
  fieldInterpolator,
  spatial,
  MapScale,
  type AdaptivePointLocator,
  type Position,
} from "@atlas/domain";
import type { LoadedRaster, RasterGeography } from "./types";
import { polygonTileMask, scanTile } from "./tileMask";
import VectorSource from "ol/source/Vector.js";
import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";

/**
 * Water for one tile at a time: the sea and the lakes become pixel masks once per tile, so a
 * pixel reads two arrays instead of querying the shapes. A tile's own geography, read at its
 * scale, replaces the raster's when given. Writes the height above water and the water kind
 * (0 land, 1 sea, 2 lake) at `at` and `at + 1`.
 */
export function tileWater(raster: LoadedRaster, locate?: AdaptivePointLocator) {
  const sea = raster.water?.channels.EffectiveSeaLevel
    ? fieldInterpolator(raster.water, "EffectiveSeaLevel", false, locate)
    : () => 0;
  const edits = (raster.field.overlays ?? [])
    .filter((overlay) => overlay.channels.includes("Elevation"))
    .map((overlay) => spatial.pointCoverage(overlay.grid.scope.footprint));
  return (extent: number[], size: number, fold: (x: number) => number, own?: RasterGeography) => {
    const ocean = own ? own.ocean : raster.field.ocean,
      lakes = own ? own.lakes : (raster.lakes ?? []);
    const marine = ocean ? polygonTileMask(ocean, extent, size, fold) : null,
      lakeAt = new Int32Array(size * size);
    lakes.forEach((lake, index) =>
      scanTile(lake.geometry, extent, size, (pixel) => (lakeAt[pixel] = index + 1), fold)
    );
    return (values: Float32Array, at: number, pixel: number, p: Position, height: number) => {
      const level = sea(p),
        edited = edits.length > 0 && edits.some((covers) => covers(p)),
        lake =
          lakeAt[pixel] > 0 &&
          (!edited || height < MapScale.native(lakes[lakeAt[pixel] - 1].level));
      const wet = ocean === undefined || edited ? height < level : marine?.[pixel] === 1;
      values[at] = MapScale.metres(height - level, "native");
      values[at + 1] = lake ? 2 : Number(wet);
    };
  };
}

/** Physical water geometry survives scalar resampling; explicit terrain edits can expose islands. */
export function terrainWater(raster: LoadedRaster, locate?: AdaptivePointLocator) {
  const sea = raster.water?.channels.EffectiveSeaLevel
    ? fieldInterpolator(raster.water, "EffectiveSeaLevel", false, locate)
    : () => 0;
  const ocean = raster.field.ocean;
  const marine = ocean ? spatial.pointCoverage(ocean) : () => false;
  const lakes = new VectorSource({
    features: raster.lakes?.map(
      (lake) =>
        new Feature({ geometry: new GeoJSON().readGeometry(lake.geometry)!, level: lake.level })
    ),
    wrapX: false,
  });
  const edits = (raster.field.overlays ?? [])
    .filter((overlay) => overlay.channels.includes("Elevation"))
    .map((overlay) => spatial.pointCoverage(overlay.grid.scope.footprint));
  return (p: Position, height: number) => {
    const level = sea(p),
      edited = edits.some((covers) => covers(p)),
      lake = lakes
        .getFeaturesAtCoordinate([p.x, p.y])
        .some((lake) => !edited || height < MapScale.native(Number(lake.get("level"))));
    const wet = ocean === undefined || edited ? height < level : marine(p);
    return { level, kind: lake ? 2 : Number(wet) };
  };
}
