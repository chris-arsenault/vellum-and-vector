export * from "@atlas/domain/model";
export interface LoadedRaster {
  /** Longitude chart used by tile gutters and repeated map views. */
  wrap?: [number, number];
  id: string;
  areaId: string;
  footprint: import("geojson").Geometry;
  bounds: number[];
  channel: string;
  field: import("@atlas/domain").GridSurface;
  water?: import("@atlas/domain").GridSurface;
  ice?: import("@atlas/domain").GridSurface;
  /** Grid holding the finalSurface classes drawn by the surface base. */
  surface?: import("@atlas/domain").GridSurface;
  lakes?: { geometry: import("geojson").Geometry; level: number }[];
}
/** Editor field metadata carries immutable resource identities, never numerical samples. */
export interface FieldReference {
  resourceId: string;
  scope: import("@atlas/domain").SpatialScope;
  bounds: import("@atlas/domain").Bounds;
  units: Record<string, string>;
  quantities: Record<string, "intensive" | "extensive" | "category">;
  channels: Record<string, { range: [number, number]; categories: number[] }>;
  patches: { resourceId: string; channels: string[]; mapOnly: boolean }[];
}
export interface RasterGeographyReference {
  scope: import("@atlas/domain").WorkspaceScope;
  areaId: string;
  geographyId: string;
  windows: import("@atlas/domain").Bounds[];
  tolerance: number;
  revision: number | string;
}
export interface RasterGeography {
  ocean?: import("geojson").Geometry | null;
  lakes: NonNullable<LoadedRaster["lakes"]>;
}
export type ResourceRaster = Omit<LoadedRaster, "field" | "water" | "ice" | "surface" | "lakes"> & {
  geography: RasterGeographyReference;
  field: FieldReference;
  water?: FieldReference;
  ice?: FieldReference;
  surface?: FieldReference;
};
export type Raster = LoadedRaster | ResourceRaster;
export function resourceRaster(raster: Raster): raster is ResourceRaster {
  return "resourceId" in raster.field;
}
export type Tool =
  | "labelPlace"
  | "labelPath"
  | "select"
  | "pan"
  | "reshape"
  | "move"
  | "refine"
  | "refinePolygon"
  | "extentEdit"
  | "regionPick"
  | "regionOutline"
  | "regionCut"
  | "regionEdit"
  | "sculpt"
  | "poi"
  | "road"
  | "river"
  | "polygon"
  | "lake"
  | "forest"
  | "hill"
  | "settlement"
  | "building"
  | "room"
  | "wall"
  | "door"
  | "border"
  | "administration"
  | "claim"
  | "control"
  | "culture"
  | "language"
  | "religion"
  | "magic"
  | "template"
  | "surveyPoint"
  | "surveyLine"
  | "surveyPolygon";
