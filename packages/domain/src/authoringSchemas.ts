import { z } from "zod";
import { finite, frameSchema, geometrySchema, identifier, valueRecordSchema } from "./schemas";
import { materializationStates, profiles } from "./model";

export const uuid = z.uuid();
export const traitSchema = z
  .object({
    field: identifier,
    kind: z.enum(["hard", "tendency", "derived", "exception"]),
    minimum: finite,
    maximum: finite,
    cause: identifier.nullable(),
    scope: geometrySchema.nullable(),
  })
  .refine((t) => t.minimum <= t.maximum, "Trait bounds must be ordered.")
  .refine(
    (t) => t.kind !== "exception" || (t.cause !== null && t.scope !== null),
    "A causal exception needs a source and footprint."
  );
export const relationSchema = z.object({ targetId: uuid, kind: identifier });
export const featureInputSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1),
  kind: identifier,
  layerId: identifier,
  geometry: geometrySchema,
  footprint: geometrySchema.optional(),
  attributes: valueRecordSchema,
  relations: z.array(relationSchema).default([]),
  protected: z.boolean().optional(),
});
export const entityInputSchema = z.object({
  id: uuid,
  name: identifier,
  kind: identifier,
  attributes: valueRecordSchema,
  relations: z.array(relationSchema).default([]),
});
export const layerInputSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  name: identifier,
  family: identifier,
  representation: z.enum(["vector", "field", "network"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  profiles: z.array(z.enum(profiles)).min(1),
  schema: valueRecordSchema,
  generator: identifier.nullable().default(null),
  representations: z
    .array(z.enum(["vector", "field", "network"]))
    .min(1)
    .optional(),
  facts: z.array(identifier).optional(),
});
export const createAreaSchema = z.object({
  id: uuid,
  parentId: uuid,
  name: identifier,
  profile: z.enum(profiles),
  footprint: geometrySchema,
  frame: frameSchema,
  approach: z.enum(["manual", "blank", "procedural"]),
  layers: z.array(identifier),
  traits: z
    .array(traitSchema)
    .refine(
      (traits) => traits.every((t) => t.kind !== "derived"),
      "Author a constraint, tendency or causal exception; derived traits describe computed geography."
    )
    .default([]),
  context: identifier.default("landscape"),
  contextFeatureId: uuid.nullable().default(null),
  createEntrance: z.boolean().default(true),
});
export const setLayerStateSchema = z.object({
  areaId: uuid,
  layerId: identifier,
  state: z.enum(materializationStates),
});
