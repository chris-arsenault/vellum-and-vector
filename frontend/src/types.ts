export * from "@atlas/domain/model";
export interface Raster {
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
export type Tool =
  | "select"
  | "pan"
  | "reshape"
  | "move"
  | "refine"
  | "refinePolygon"
  | "extentEdit"
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
