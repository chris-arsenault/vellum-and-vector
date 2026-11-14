import { z } from "zod";
import type { Geometry } from "geojson";
import type { World } from "./model";
export declare const regionViewSchema: z.ZodObject<
  {
    parentId: z.ZodNullable<z.ZodUUID>;
    footprint: z.ZodType<Geometry, unknown, z.core.$ZodTypeInternals<Geometry, unknown>>;
  },
  z.core.$strip
>;
export type RegionView = World["views"][number] & {
  region: z.infer<typeof regionViewSchema>;
};
/** A geographic map needs room for an area, rather than a narrow line or sliver. */
export declare const minimumRegionWidthMetres: (source: Geometry) => number;
export declare function usefulRegionSize(geometry: Geometry, source: Geometry): boolean;
export declare function regionViews(world: World, areaId: string): RegionView[];
export declare function regionSourceAreaId(
  world: World,
  regionId: string | null,
  fallback: string
): string;
export declare function regionLineage(world: World, id: string | null): RegionView[];
export declare function regionFootprint(
  world: World,
  areaId: string,
  parentId: string | null
): Geometry;
/** Unselected parts remain available; existing sibling edges are reused exactly. */
export declare function availableRegionFootprint(
  world: World,
  areaId: string,
  parentId: string | null,
  excludeId?: string | null
): Geometry | null;
export declare function validateRegionView(
  world: World,
  view: World["views"][number]
): {
  id: string;
  name: string;
  areaId: string;
  layers: import("./model").LayerStyle[];
  region?: {
    parentId: string | null;
    footprint: Geometry;
  };
  regionId?: string;
  raster?: import("./model").RasterPresentation;
  cartography?: import("./cartographicPresentation").CartographicPresentation;
};
