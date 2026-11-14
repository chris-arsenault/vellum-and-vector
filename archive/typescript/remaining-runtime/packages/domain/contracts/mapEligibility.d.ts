import type { Geometry } from "geojson";
import type { AtlasFeature, Representation, World } from "./model";
import type { DomainSnapshot } from "./operations";
import type { Diagnostic } from "./errors";
export interface MappedDrawing {
  mapOnly?: boolean;
  mapSource?: Representation;
  mapBaseline?: Pick<AtlasFeature, "geometry" | "footprint" | "attributes" | "relations">;
}
/** Retain the replaced fine representation and the drawing before its first edit. */
export declare function mappedBaseline(
  world: World,
  feature: AtlasFeature,
  areaId: string
):
  | {
      mapSource: Representation | undefined;
      mapBaseline:
        Pick<AtlasFeature, "footprint" | "geometry" | "attributes" | "relations"> | undefined;
    }
  | {
      mapBaseline: {
        footprint?: Geometry | undefined;
        geometry: Geometry;
        attributes: Record<string, unknown>;
        relations: import("./model").Relation[];
      };
      mapSource?: Representation | undefined;
    };
export declare function hasStructuralMapEdit(
  detail: Representation,
  feature: AtlasFeature
): boolean;
/** Cosmetic overrides follow fresh geography rather than pinning an obsolete drawing. */
export declare function refreshMappedPresentation(
  world: World,
  feature: AtlasFeature,
  areaId: string,
  detail: Representation
): Representation;
export interface MappedGenerationConflict {
  subjectId: string;
  areaId: string;
  name: string;
}
/** Any overlapping drawing in this located space must survive, regardless of hierarchy depth. */
export declare function mappedGenerationConflicts(
  snapshot: DomainSnapshot,
  areaId: string,
  features?: Iterable<AtlasFeature>
): MappedGenerationConflict[];
export declare function mappedGenerationDiagnostics(
  snapshot: DomainSnapshot,
  areaId: string,
  features?: Iterable<AtlasFeature>
): Diagnostic[];
