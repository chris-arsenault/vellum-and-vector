import type { Geometry } from "geojson";
import type { DrawnMapInput } from "./drawnMap";
import type { TerrainMark } from "./drawnTerrain";
import type { FieldMark } from "./drawnFields";
import type { DrawingGeography } from "./drawnGeography";

export interface IllustrationRequest {
  id: number;
  input: DrawnMapInput;
  footprint: Geometry;
}
export interface DrawingProducts {
  geography: DrawingGeography;
  oceans: Geometry[];
  coasts: Geometry[];
  outside: Geometry | null;
}
export interface IllustrationReply extends DrawingProducts {
  id: number;
  terrain: TerrainMark[];
  fields: FieldMark[];
  error?: string;
}
