import type {
  Area,
  AtlasFeature,
  Connection,
  Entity,
  Layer,
  NetworkNode,
  NetworkReach,
  TemplateSocket,
  Trait,
  Profile,
} from "./model";
import type { ParameterValues } from "./schemas";

export interface TemplateDefinition {
  id: string;
  version: number;
  name: string;
  units: "metre" | "foot";
  rootAreaId: string;
  parentProfiles: Profile[];
  areas: Area[];
  features: AtlasFeature[];
  entities: Entity[];
  layers: Layer[];
  nodes: NetworkNode[];
  reaches: NetworkReach[];
  connections: Connection[];
  sockets: TemplateSocket[];
  requirements: {
    contextKinds: string[] | null;
    fields: Trait[];
    maximumSlope: number | null;
    streetAccess: boolean;
  } | null;
  workflow: { scope: string; id: string; version: number; parameters: ParameterValues } | null;
  contextReferences: { id: string; worldId: string; kind: string }[];
}
export interface TemplateInstance {
  id: string;
  definitionScope: string;
  rootAreaId: string;
  members: { kind: string; definitionId: string; objectId: string }[];
  layers: { definitionId: string; layerId: string }[];
}
