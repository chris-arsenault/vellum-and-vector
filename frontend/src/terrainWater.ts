import {
  fieldInterpolator,
  spatial,
  type AdaptivePointLocator,
  type Position,
  type GridSurface,
} from "@atlas/domain";
import type { Raster } from "./types";
import VectorSource from "ol/source/Vector.js";
import Feature from "ol/Feature.js";
import GeoJSON from "ol/format/GeoJSON.js";

/** Physical water geometry survives scalar resampling; explicit terrain edits can expose islands. */
export function terrainWater(raster: Raster, locate?: AdaptivePointLocator) {
  const physical = composedWater(raster.field),
    edits = terrainEdits(raster.field);
  const sea = raster.water?.channels.seaLevel
    ? fieldInterpolator(raster.water, "seaLevel", false, locate)
    : () => 0;
  const ocean = raster.field.ocean;
  const marine = ocean ? spatial.pointCoverage(ocean) : () => false;
  const lakes = new VectorSource({
    features: lakeSurfaces(raster)?.map(
      (lake) =>
        new Feature({ geometry: new GeoJSON().readGeometry(lake.geometry)!, level: lake.level })
    ),
    wrapX: false,
  });
  return (p: Position, height: number) => {
    const edited = edits.some((covers) => covers(p));
    const shared = physical(p),
      explicitLake = lakes.getFeaturesAtCoordinate([p.x, p.y]).length > 0;
    if (shared && !explicitLake) {
      if (!edited) return shared;
      return { level: shared.level, kind: height < shared.level ? shared.kind || 1 : 0 };
    }
    const lake = lakes
        .getFeaturesAtCoordinate([p.x, p.y])
        .find((lake) => !edited || height < Number(lake.get("level"))),
      level = lake ? Number(lake.get("level")) : sea(p);
    const wet = ocean === undefined || edited ? height < level : marine(p);
    return { level, kind: lake ? 2 : Number(wet) };
  };
}
function terrainEdits(grid: GridSurface): ((p: Position) => boolean)[] {
  return (grid.overlays ?? []).flatMap((overlay) =>
    overlay.inherited
      ? terrainEdits(overlay.grid)
      : overlay.channels.includes("elevation")
        ? [spatial.pointCoverage(overlay.grid.scope.footprint)]
        : []
  );
}
function composedWater(grid: GridSurface): (p: Position) => { level: number; kind: number } | null {
  const source = grid.reconstruction?.water;
  const kind = source ? fieldInterpolator({ ...grid, overlays: undefined }, "water") : null,
    level = source ? fieldInterpolator({ ...grid, overlays: undefined }, "waterLevel") : null;
  const overlays = [...(grid.overlays ?? [])]
    .reverse()
    .filter(
      (o) => o.channels.includes("water") || (o.inherited && o.channels.includes("elevation"))
    )
    .map((o) => ({
      covers: spatial.pointCoverage(o.grid.scope.footprint),
      read: composedWater(o.grid),
    }));
  return (p) => {
    for (const overlay of overlays)
      if (overlay.covers(p)) {
        const water = overlay.read(p);
        if (water) return water;
      }
    return kind && level ? { kind: kind(p), level: level(p) } : null;
  };
}
function lakeSurfaces(raster: Raster) {
  if (raster.lakes?.length) return raster.lakes;
  return raster.field.reconstruction?.water?.lakes.map((lake) => ({
    geometry: lake.footprint,
    level: lake.level,
  }));
}
