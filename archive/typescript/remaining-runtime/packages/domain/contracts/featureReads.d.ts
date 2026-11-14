import type { Geometry } from "geojson";
import { type CompositionSpatial } from "./composition";
import { type AtlasFeature, type World } from "./model";
import { type Spatial } from "./spatial";
/** Sources stay owned by world.magic; readers and selection share their semantic identities. */
export declare function authoredMagicFeatures(world: World): AtlasFeature[];
export declare function canonicalFeatures(
  world: World,
  gis?: Pick<Spatial, "buffer">
): AtlasFeature[];
export declare function featureIntersects(
  feature: Pick<AtlasFeature, "geometry" | "footprint">,
  extent: Geometry,
  gis?: Pick<Spatial, "intersects">
): boolean;
export declare function presentAtlasFeature(
  world: World,
  feature: AtlasFeature,
  areaId: string,
  gis?: CompositionSpatial & Pick<Spatial, "intersects">
): {
  geometry: Geometry;
  placeId?: string;
  footprint?: Geometry;
  id: string;
  name: string;
  kind: string;
  layerId: string;
  areaId: string;
  detail: Record<string, import("./model").Representation>;
  attributes: Record<string, unknown>;
  relations: import("./model").Relation[];
  state: import("./model").State;
  protected: boolean;
  actor: string;
  generationId: string | null;
  causes: string[];
  generationDomain?: string | null;
  mapOnly?: boolean | undefined;
} | null;
export declare function readAtlasFeatures(
  world: World,
  areaId?: string,
  extent?: Geometry
): {
  geometry: Geometry;
  placeId?: string;
  footprint?: Geometry;
  id: string;
  name: string;
  kind: string;
  layerId: string;
  areaId: string;
  detail: Record<string, import("./model").Representation>;
  attributes: Record<string, unknown>;
  relations: import("./model").Relation[];
  state: import("./model").State;
  protected: boolean;
  actor: string;
  generationId: string | null;
  causes: string[];
  generationDomain?: string | null;
  mapOnly?: boolean | undefined;
}[];
