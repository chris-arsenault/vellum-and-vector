import type { World } from "./model";
import type { Geometry } from "geojson";
export interface MapOwnership {
  sourceAreaId: string;
  sourceRevision: number;
  /** The finished parent selected for capture, when that map has been published. */
  sourceMap?: {
    mapId: string;
    revision: string;
  };
  refinementLevel: number;
  /** The captured working frame stays stable across repeated refinement. */
  extent?: Geometry;
}
/** Ancestry locates independent maps but never supplies their live geographic records. */
export declare function ownsMapGeography(world: Pick<World, "areas">, areaId: string): boolean;
/**
 * Geography is generated on every map except a building interior, which has no terrain. A
 * world whose history is fixed is one with any such run.
 */
export declare function hasGeneratedGeography(world: Pick<World, "areas" | "generations">): boolean;
/** Legacy authoring representations stop at the first independently owned map. */
export declare function geographyAreas(world: Pick<World, "areas">, areaId: string): string[];
