import type { Geometry } from "geojson";
import type {
  Area,
  AtlasFeature,
  Connection,
  Entity,
  Layer,
  World,
  NetworkNode,
  NetworkReach,
  LocatedRepresentation,
  FieldRef,
  FieldPatch,
} from "./model";
import type { ResourceReference, SpatialScope } from "./schemas";

export const objectKinds = [
  "area",
  "feature",
  "entity",
  "layer",
  "connection",
  "field",
  "node",
  "reach",
  "representation",
  "coverage",
  "fieldPatch",
  "magic",
  "landmark",
  "view",
  "society",
  "drainage",
] as const;
export type ObjectKind = (typeof objectKinds)[number];
export interface RevisionReference {
  kind: ObjectKind;
  id: string;
  revisionId: string;
  version: number;
}
export interface ReadRequirements {
  scope: SpatialScope;
  objects: { kind: ObjectKind; ids: string[] }[];
  spatialLayers: string[];
  channels: { fieldId: string; names: string[]; haloCells?: number }[];
  parentHistory: string[];
  dependencies: boolean;
  references?: string[];
  referencesTo?: string[];
  layerContents?: string[];
  completeRepresentations?: string[];
  connected?: { featureIds: string[]; mode: "network" | "circulation" };
  constraints?: { intersectingAreas: boolean; descendantsOf: string[]; boundaryFeatures: string[] };
}
export interface DomainSnapshot {
  world: World;
  scope: SpatialScope;
  revisions: RevisionReference[];
  resources: ResourceReference[];
  numerical: Record<string, import("./grids").GridSurface>;
  identities: Record<string, string>;
  coverage: import("./coverage").MaterializedCoverage[];
  fieldPatches: FieldPatch[];
}
export type DomainWrite =
  | { kind: "area"; value: Area }
  | { kind: "feature"; value: AtlasFeature }
  | { kind: "entity"; value: Entity }
  | { kind: "layer"; value: Layer }
  | { kind: "connection"; value: Connection }
  | { kind: "field"; value: FieldRef & { resourceId: string } }
  | { kind: "node"; value: NetworkNode }
  | { kind: "reach"; value: NetworkReach }
  | { kind: "representation"; value: LocatedRepresentation }
  | { kind: "coverage"; value: import("./coverage").MaterializedCoverage }
  | { kind: "fieldPatch"; value: FieldPatch }
  | { kind: "magic"; value: World["magic"][number] }
  | { kind: "landmark"; value: World["landmarks"][number] }
  | { kind: "view"; value: World["views"][number] }
  | { kind: "society"; value: import("./society").SocietyRegion & { id: string } }
  | { kind: "drainage"; value: import("./drainage").DrainageNetwork & { id: string } };
export type FactInvalidation = { fact: string; cause: string } & (
  { scope: "world" } | { scope: "spatial"; footprint: Geometry; spaceId: string }
);
export interface ChangeSet {
  operationId: string;
  actor: string;
  worldId: string;
  expectedVersion: number;
  readSet: RevisionReference[];
  writes: DomainWrite[];
  removes: { kind: ObjectKind; id: string }[];
  invalidations: FactInvalidation[];
  highImpact: boolean;
  worldMetadata?: Pick<
    World,
    "name" | "seed" | "epochs" | "humanEras" | "magicSystems" | "confluences" | "societies"
  >;
  templateInstances?: import("./templates").TemplateInstance[];
  fieldArtifacts?: { reference: ResourceReference; grid: import("./grids").Grid }[];
}
