import { z } from "zod";
import {
  geometrySchema,
  identifier,
  positionSchema,
  valueRecordSchema,
  type ResourceType,
} from "./schemas";
import { materializationStates } from "./model";

const attributes = valueRecordSchema;
const relation = z.object({ targetId: identifier, kind: identifier });
export const candidateFeatureSchema = z.object({
  id: identifier,
  areaId: identifier,
  layerId: identifier,
  name: z.string(),
  kind: identifier,
  geometry: geometrySchema,
  footprint: geometrySchema.optional(),
  state: z.enum(materializationStates),
  protected: z.boolean(),
  actor: identifier,
  attributes,
  causes: z.array(identifier),
  relations: z.array(relation),
});
export const candidateEntitySchema = z.object({
  id: identifier,
  name: z.string(),
  kind: identifier,
  state: z.enum(materializationStates),
  attributes,
  relations: z.array(relation),
});
export const networkSchema = z.object({
  nodes: z.array(
    z.object({
      id: identifier,
      kind: identifier,
      spaceId: identifier,
      position: positionSchema,
      waterLevel: z.number().finite().nullable(),
    })
  ),
  reaches: z.array(
    z.object({
      id: identifier,
      featureId: identifier,
      start: identifier,
      end: identifier,
      geometry: geometrySchema,
      flow: z.number().finite(),
      endFlow: z.number().finite().nullable(),
    })
  ),
  connections: z.array(
    z.object({
      id: identifier,
      kind: identifier,
      flow: z.number().finite(),
      a: z.object({
        nodeId: identifier.optional(),
        areaId: identifier,
        position: positionSchema,
        featureId: identifier.nullable(),
      }),
      b: z.object({
        nodeId: identifier.optional(),
        areaId: identifier,
        position: positionSchema,
        featureId: identifier.nullable(),
      }),
    })
  ),
});
export const historySchema = z.object({
  epochId: identifier,
  duration: z.number().finite().nonnegative(),
  parentEpoch: identifier.nullable(),
  parentResource: identifier.nullable(),
  previousResource: identifier.nullable(),
  events: z.array(
    z.object({
      id: identifier,
      kind: identifier,
      subjectId: identifier.nullable(),
      epochId: identifier,
      position: positionSchema,
      amount: z.number().finite(),
      unit: identifier,
      causes: z.array(identifier),
    })
  ),
});
export type CandidateFeature = z.infer<typeof candidateFeatureSchema>;
export type CandidateEntity = z.infer<typeof candidateEntitySchema>;
export type NetworkPayload = z.infer<typeof networkSchema>;
export type HistoryPayload = z.infer<typeof historySchema>;
export const featuresType: ResourceType<CandidateFeature[]> = {
  id: "atlas.features",
  version: 1,
  kind: "vector",
  schema: z.array(candidateFeatureSchema),
};
export const entitiesType: ResourceType<CandidateEntity[]> = {
  id: "atlas.entities",
  version: 1,
  kind: "entities",
  schema: z.array(candidateEntitySchema),
};
export const networkType: ResourceType<NetworkPayload> = {
  id: "atlas.network",
  version: 1,
  kind: "network",
  schema: networkSchema,
};
export const historyType: ResourceType<HistoryPayload> = {
  id: "atlas.history",
  version: 1,
  kind: "history",
  schema: historySchema,
};
