import {
  fieldInterpolator,
  spatial,
  type AdaptivePointLocator,
  type Position,
} from "@atlas/domain";
import type { Raster } from "./types";
import VectorSource from "ol/source/Vector.js";
import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";

/** Physical water geometry survives scalar resampling; explicit terrain edits can expose islands. */
export function terrainWater(raster: Raster, locate?: AdaptivePointLocator) {
  const sea = raster.water?.channels.seaLevel
    ? fieldInterpolator(raster.water, "seaLevel", false, locate)
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
    .filter((overlay) => overlay.channels.includes("elevation"))
    .map((overlay) => spatial.pointCoverage(overlay.grid.scope.footprint));
  return (p: Position, height: number) => {
    const level = sea(p),
      edited = edits.some((covers) => covers(p)),
      lake = lakes
        .getFeaturesAtCoordinate([p.x, p.y])
        .some((lake) => !edited || height < Number(lake.get("level")));
    const wet = ocean === undefined || edited ? height < level : marine(p);
    return { level, kind: lake ? 2 : Number(wet) };
  };
}
