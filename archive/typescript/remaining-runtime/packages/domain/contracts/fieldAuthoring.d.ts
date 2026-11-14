import type { Geometry } from "geojson";
import type { Area, Layer } from "./model";
import type { Grid } from "./grids";
import type { ChangeSet, DomainSnapshot } from "./operations";
import { type IntentContext } from "./intent";
export declare function fieldArea(
  snapshot: DomainSnapshot,
  context: IntentContext,
  id: string
): Area;
export declare function fieldArtifact(
  changes: ChangeSet,
  grid: Grid<string>,
  layer: Layer,
  lineage?: string[]
): {
  id: string;
  kind: "value" | "field" | "vector" | "network" | "entities" | "history";
  schemaId: string;
  schemaVersion: number;
  revision: string;
  scope: {
    revision: number;
    worldId: string;
    areaId: string;
    spaceId: string;
    footprint: Geometry;
    crsId: string;
    time: string;
    resolution: number | null;
  };
  unit: string;
  facts: string[];
  lineage: string[];
};
export interface AuthoredFieldDefinition {
  id: string;
  areaId: string;
  layerId: string;
  footprint: Geometry;
  parentFieldId?: string;
}
/** Numerical operations publish their working grid directly; command JSON carries configuration. */
export declare function authoredFieldChanges(
  data: AuthoredFieldDefinition,
  grid: Grid<string>,
  context: IntentContext,
  snapshot: DomainSnapshot,
  reconcile?: boolean
): ChangeSet;
