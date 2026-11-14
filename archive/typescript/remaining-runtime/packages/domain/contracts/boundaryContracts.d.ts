import type { Geometry } from "geojson";
import { type Area, type AtlasFeature, type Position, type World } from "./model";
import type { DomainSnapshot } from "./operations";
export interface FieldSample {
  point: Position;
  values: Record<string, number>;
}
export interface BoundaryHistory {
  epochId: string;
  parentEpoch: string | null;
  forcingId: string | null;
  resources: string[];
}
export declare function sampleFields(snapshot: DomainSnapshot, p: Position): Record<string, number>;
export declare function boundaryRings(footprint: Geometry): number[][][];
export declare function featureStation(
  snapshot: DomainSnapshot,
  feature: AtlasFeature,
  channel: string,
  p: Position
): number | null;
export declare function establishBoundary(
  snapshot: DomainSnapshot,
  area: Area
): NonNullable<Area["boundary"]>;
export declare function validateCrossings(
  snapshot: DomainSnapshot,
  area: Area,
  feature: AtlasFeature,
  geometry: Geometry,
  attributes: Record<string, unknown>
): void;
export declare function validateRiverProfile(
  world: Pick<World, "reference" | "areas">,
  feature: AtlasFeature,
  geometry: Geometry,
  attributes: Record<string, unknown>
): void;
