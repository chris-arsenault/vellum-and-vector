import type { Geometry } from "geojson";

export type Optional<T> = T | undefined;
export type Profile = "world" | "region" | "local" | "site" | "interior";
export const profiles: Profile[] = ["world", "region", "local", "site", "interior"];
export type State =
  "unmaterialized" | "generated" | "authored" | "protected" | "intentionallyEmpty" | "stale";
export const materializationStates: State[] = [
  "unmaterialized",
  "generated",
  "authored",
  "protected",
  "intentionallyEmpty",
  "stale",
];
export interface Position {
  x: number;
  y: number;
  z: number;
}
export interface Frame {
  origin: Position;
  rotation: number;
  metresPerUnit: number;
  floor: string | null;
}
export interface Trait {
  field: string;
  kind: string;
  minimum: number;
  maximum: number;
  cause: string | null;
  scope: Geometry | null;
}
export interface Crossing {
  featureId: string;
  point: Position;
  kind: string;
  flow: number;
  elevation: number;
  direction?: string;
  nodeId?: string | null;
  receivingFeatureId?: string | null;
  flowUncertainty?: number;
  flowMinimum?: number | null;
  flowMaximum?: number | null;
  flowKnown?: boolean;
  elevationKnown?: boolean;
}
export interface WaterFlux {
  id: string;
  point: Position;
  direction: Position;
  rate: number;
  crossing: string;
}
export interface BoundaryHistory {
  epochId: string;
  parentEpoch: string | null;
  forcingId: string | null;
  resources: string[];
}
export interface FieldSample {
  point: Position;
  values: Record<string, number>;
}
export interface Epoch {
  duration?: number;
  impacts?: number;
  volcanism?: number;
  magicActivity?: Record<string, number>;
  id: string;
  tectonics: number;
  hydrology: number;
  ice: number;
  coasts: number;
  temperature: number;
  seaLevel: number;
}
export interface Area {
  spaceId?: string;
  context: string;
  id: string;
  name: string;
  parentId: string | null;
  profile: Profile;
  footprint: Geometry;
  frame: Frame;
  version: number;
  traits: Trait[];
  localTraits?: Trait[];
  layers: Record<string, State>;
  boundary: {
    version: number;
    parentId: string;
    parentVersion: number;
    crossings: Crossing[];
    samples: FieldSample[];
    epochs: Epoch[];
    rings?: FieldSample[][] | null;
    waterFluxes?: WaterFlux[] | null;
    history?: BoundaryHistory[];
  } | null;
  templateId: string | null;
  contextFeatureId?: string | null;
  templateInstanceId?: string | null;
  recipeJobId?: string | null;
}
export interface Representation {
  id?: string;
  protected: boolean;
  needsReconciliation: boolean;
  attributes: Record<string, unknown> | null;
  geometry: Geometry;
  state: State;
  actor: string;
  generationId: string | null;
}
export interface LocatedRepresentation extends Representation {
  id: string;
  featureId: string;
  areaId: string;
}
export interface Relation {
  targetId: string;
  kind: string;
}
export interface AtlasFeature {
  id: string;
  name: string;
  kind: string;
  layerId: string;
  areaId: string;
  geometry: Geometry;
  detail: Record<string, Representation>;
  attributes: Record<string, unknown>;
  relations: Relation[];
  state: State;
  protected: boolean;
  actor: string;
  generationId: string | null;
  causes: string[];
  generationDomain?: string | null;
}
export interface Entity {
  id: string;
  name: string;
  kind: string;
  attributes: Record<string, unknown>;
  relations?: Relation[];
  state?: State;
}
export interface Layer {
  id: string;
  name: string;
  family: string;
  representation: string;
  color: string;
  profiles: Profile[];
  schema: Record<string, unknown>;
  generator: string | null;
  representations?: ("vector" | "field" | "network")[];
  facts?: string[];
}
export interface FieldRef {
  id: string;
  areaId: string;
  layerId: string;
  algorithm: string;
  source: { kind: "operation" | "run"; id: string };
  samples: number;
  channels: string[] | null;
  resourceId?: string | null;
  state?: State;
  footprint?: Geometry;
  spaceId?: string;
}
export interface FieldPatch {
  id: string;
  fieldId: string;
  areaId: string;
  spaceId: string;
  footprint: Geometry;
  channels: string[];
  actor: string;
  resourceId: string;
  protected: boolean;
  createdVersion: number;
}
export interface Raster {
  footprint: Geometry;
  id: string;
  areaId: string;
  bounds: number[];
  width: number;
  height: number;
  channel: string;
  values: number[];
  water?: number[];
  ice?: number[];
}
export interface TemplateSocket {
  id: string;
  featureId: string;
  position: Position;
  kind: string;
  required: boolean;
  targetKinds: string[] | null;
  spaceId?: string | null;
  connectsTo?: string | null;
}
export interface Template {
  id: string;
  name: string;
  profile: Profile;
  parentProfiles: Profile[];
  footprint: Geometry;
  features: AtlasFeature[];
  traits: Trait[];
  frame: Frame;
  version?: number;
  units?: string;
  sockets?: TemplateSocket[] | null;
  requirements?: {
    contextKinds: string[] | null;
    fields: Trait[] | null;
    maximumSlope: number | null;
    streetAccess: boolean;
  } | null;
  recipe?: { domains: string[]; seed: number; quality: string } | null;
  entities?: Entity[] | null;
  layers?: Layer[] | null;
  spaces?: { id: string; name: string; footprint: Geometry; frame: Frame }[] | null;
  context?: string;
}
export interface LayerStyle {
  symbols?: import("geostyler-style").Style;
  labels?: boolean;
  filter?: string | null;
  layerId: string;
  visible: boolean;
  opacity: number;
  color: string;
  minScale: number;
}
export interface FieldStyle {
  channel: string;
  visible: boolean;
  opacity: number;
  palette: "viridis" | "magma" | "blueRed" | "terrain";
  scale: "linear" | "log";
  range: [number, number] | null;
}
export interface RasterPresentation {
  base: "topographic" | "relief";
  sunAzimuth: number;
  sunElevation: number;
  exaggeration: number;
  contourInterval: number;
  fields: FieldStyle[];
}
export interface Connection {
  id: string;
  kind: string;
  a: { areaId: string; position: Position; featureId: string | null; nodeId?: string };
  b: { areaId: string; position: Position; featureId: string | null; nodeId?: string };
  flow: number;
}
export interface NetworkNode {
  id: string;
  kind: string;
  position: Position;
  spaceId: string | null;
  waterLevel: number | null;
}
export interface NetworkReach {
  id: string;
  featureId: string;
  start: string;
  end: string;
  geometry: Geometry;
  flow: number;
  endFlow: number | null;
}
export interface World {
  magicSystems?: import("./magicSystems").MagicSystem[];
  featureCount?: number;
  id: string;
  name: string;
  seed: number;
  version: number;
  owner: string;
  reference: {
    id: string;
    domain: Geometry;
    topology: string;
    units: string;
    axes: string;
    verticalDatum: string;
    version?: number;
    precision?: number;
  };
  areas: Record<string, Area>;
  features: Record<string, AtlasFeature>;
  layers: Record<string, Layer>;
  fields: FieldRef[];
  entities: Record<string, Entity>;
  templates: Record<string, Template>;
  magic: {
    systemId?: string;
    areaId?: string;
    spaceId?: string;
    scope?: Geometry | null;
    id: string;
    name: string;
    source: Position;
    radius: number;
    strength: number;
    propagation: string;
    effect: string;
    decay: number;
    storage: number;
    dependsOn: string[] | null;
    startsAtEpoch: number;
  }[];
  epochs: Epoch[];
  humanEras?: {
    id: string;
    years: number;
    physicalEpoch: string | null;
    mobility: number;
    politicalCapacity: number;
  }[];
  generations: {
    physicalEpochs?: Epoch[];
    magicSystems?: import("./magicSystems").MagicSystem[];
    id: string;
    domains: string[];
    quality: string;
    completedAt: string;
    areaId?: string;
    seed?: number;
    parameters?: Record<string, number>;
  }[];
  views: {
    id: string;
    name: string;
    areaId: string;
    layers: LayerStyle[];
    raster?: RasterPresentation;
  }[];
  connections?: Record<string, Connection>;
  networkNodes?: Record<string, NetworkNode>;
  networkReaches?: Record<string, NetworkReach>;
}
export interface Command {
  operationId: string;
  expectedVersion: number;
  kind: string;
  data: Record<string, unknown>;
}
export interface Impact {
  features: string[];
  areas: string[];
  layers: string[];
  invalidations: string[];
  highImpact: boolean;
}
export interface Proposal {
  candidate: World;
  impact: Impact;
}
export interface Job {
  recoverable: boolean;
  id: string;
  worldId: string;
  status: string;
  stage: string;
  progress: number;
  cancelRequested: boolean;
  error: string | null;
  attempt: number;
}
export interface History {
  operationId: string;
  version: number;
  actor: string;
  kind: string;
  at: string;
}
export type Tool =
  "select" | "reshape" | "poi" | "road" | "river" | "polygon" | "refine" | "sculpt";
