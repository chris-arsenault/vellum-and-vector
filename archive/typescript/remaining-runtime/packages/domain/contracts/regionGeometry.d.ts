import type { Geometry, LineString, Polygon } from "geojson";
import type { World, Position as LocatedPosition } from "./model";
export interface RegionCandidate {
  name: string;
  footprint: Geometry;
}
export declare function polygonParts(geometry: Geometry): Polygon[];
/** Join the two chart-edge fragments before choosing a component or subdividing it. */
export declare function connectedRegionParts(
  reference: World["reference"],
  geometry: Geometry,
  position: LocatedPosition | null
): Polygon[];
/** Area overlays may also return lines or points where boundaries merely touch. */
export declare function polygonGeometry(geometry: Geometry | null): Geometry | null;
export declare function regionBoundaryLines(geometry: Geometry): LineString[];
/** Snap cut endpoints to existing geographic edges at the map's current pixel tolerance. */
export declare function snapRegionCut(
  line: LineString,
  boundaries: Geometry[],
  tolerance: number
): LineString;
