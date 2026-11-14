import type { Geometry } from "geojson";
import { type Area, type AtlasFeature, type World, type Profile } from "./model";
import { Spatial } from "./spatial";
export type CompositionSpatial = Pick<Spatial, "intersection" | "difference" | "union">;
export declare function geometryParts(g: Geometry | null): Geometry[];
export declare function geometryDimension(g: Geometry): number;
export declare function combineGeometry(
  parts: Geometry[],
  dimension: number,
  gis?: Pick<Spatial, "union">
): Geometry | null;
export declare function areaSpace(world: Pick<World, "id" | "areas">, id: string): string;
export declare function isDescendant(
  areas: Record<string, Area>,
  child: string,
  ancestor: string
): boolean;
export declare function areaDepth(areas: Record<string, Area>, id: string): number;
export declare function composeFeature(
  world: Pick<World, "id" | "areas" | "features"> & Partial<Pick<World, "reference">>,
  feature: AtlasFeature,
  path?: string[],
  profile?: Profile,
  areaId?: string,
  gis?: CompositionSpatial
): Geometry | null;
/** The physical/affected extent composes independently from a site's point or course. */
export declare function composeFootprint(
  world: World,
  feature: AtlasFeature,
  profile?: Profile,
  areaId?: string,
  gis?: CompositionSpatial
): Geometry | null;
