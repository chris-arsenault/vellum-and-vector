import { rectangle, spatial, type Bounds, type Position } from "@atlas/domain";
import type { Geometry } from "geojson";

/** Inside a whole tile, outside it, or a prepared point test for a tile on the edge. */
export type TileInside = boolean | ((p: Position) => boolean);

/** Footprint coverage resolved once per tile with prepared GEOS predicates. */
export function tileCoverage(footprint: Geometry): (extent: Bounds) => TileInside {
  const covers = spatial.geometryCoverage(footprint),
    meets = spatial.intersectionPredicate(footprint),
    point = spatial.pointCoverage(footprint);
  return (extent) => {
    const tile = rectangle(extent);
    if (!meets(tile)) return false;
    return covers(tile) || point;
  };
}
/** Wrapped samples fold into the chart, so a tile across the seam spans the chart's width. */
export function sampledExtent(extent: number[], wrap?: number[]): Bounds {
  if (!wrap || (extent[0] >= wrap[0] && extent[2] <= wrap[1])) return extent.slice(0, 4) as Bounds;
  return [wrap[0], extent[1], wrap[1], extent[3]];
}
export const insideAt = (inside: TileInside, p: Position) =>
  inside === true || (inside !== false && inside(p));
