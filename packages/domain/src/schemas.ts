import { z } from "zod";
import type { Geometry } from "geojson";

export const finite = z.number().finite();
export const identifier = z.string().min(1);
export const positionSchema = z.object({ x: finite, y: finite, z: finite });
export const frameSchema = z.object({
  origin: positionSchema,
  rotation: finite,
  metresPerUnit: finite.positive(),
  floor: z.string().nullable(),
});
const coordinate = z.array(finite).min(2).max(3);
const line = z.array(coordinate).min(2);
const polygon = z.array(z.array(coordinate).min(4)).min(1);
export const geometrySchema: z.ZodType<Geometry> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("Point"), coordinates: coordinate }),
    z.object({
      type: z.literal("MultiPoint"),
      coordinates: z.array(coordinate).min(1),
    }),
    z.object({ type: z.literal("LineString"), coordinates: line }),
    z.object({
      type: z.literal("MultiLineString"),
      coordinates: z.array(line).min(1),
    }),
    z.object({ type: z.literal("Polygon"), coordinates: polygon }),
    z.object({
      type: z.literal("MultiPolygon"),
      coordinates: z.array(polygon).min(1),
    }),
    z.object({
      type: z.literal("GeometryCollection"),
      geometries: z.array(geometrySchema).min(1),
    }),
  ])
);
export const referenceSchema = z.object({
  id: identifier,
  domain: geometrySchema,
  topology: z.literal("planar"),
  boundaryMode: z.enum(["cylinder", "ocean", "none"]).default("none"),
  units: z.literal("metre"),
  axes: z.literal("east,north,up"),
  verticalDatum: identifier,
  version: z.number().int().positive(),
  precision: finite.positive(),
});
export const scopeSchema = z.object({
  worldId: identifier,
  areaId: identifier,
  spaceId: identifier,
  footprint: geometrySchema,
  crsId: identifier,
  revision: z.number().int().positive(),
  time: identifier,
  resolution: finite.positive().nullable(),
});
export type SpatialScope = z.infer<typeof scopeSchema>;
export const durableScopeSchema = scopeSchema.extend({
  worldId: z.uuid(),
  areaId: z.uuid(),
  spaceId: z.uuid(),
});

export const scalarSchema = z.union([z.string(), finite, z.boolean(), z.null()]);
export type Scalar = z.infer<typeof scalarSchema>;
export type Value = Scalar | Value[] | { [key: string]: Value };
function isValueRecord(value: unknown): value is Record<string, Value> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return false;
  return Object.values(value).every((child) => valueSchema.safeParse(child).success);
}
export const valueSchema: z.ZodType<Value> = z.lazy(() =>
  z.union([scalarSchema, z.array(valueSchema), z.custom<Record<string, Value>>(isValueRecord)])
);
export const valueRecordSchema = z.custom<Record<string, Value>>(isValueRecord);
export interface ParameterDefinition {
  type: "number" | "integer" | "boolean" | "text" | "enum" | "resource" | "record" | "list";
  unit: string | null;
  required: boolean;
  nullable?: boolean;
  default?: Value;
  minimum?: number;
  maximum?: number;
  choices?: Scalar[];
  fields?: Record<string, ParameterDefinition>;
  items?: ParameterDefinition;
  override?: "replace" | "merge";
}
function validateParameterShape(definition: ParameterDefinition, context: z.RefinementCtx) {
  if (definition.type === "enum" && !definition.choices?.length)
    context.addIssue({ code: "custom", message: "Enumerated parameters need declared choices." });
  if (definition.type === "record" && definition.fields === undefined)
    context.addIssue({ code: "custom", message: "Record parameters need declared fields." });
  if (definition.type === "list" && definition.items === undefined)
    context.addIssue({ code: "custom", message: "List parameters need a declared item type." });
}
export const parameterSchema: z.ZodType<ParameterDefinition> = z.lazy(() =>
  z
    .object({
      type: z.enum(["number", "integer", "boolean", "text", "enum", "resource", "record", "list"]),
      unit: z.string().nullable(),
      required: z.boolean(),
      nullable: z.boolean().optional(),
      default: valueSchema.optional(),
      minimum: finite.optional(),
      maximum: finite.optional(),
      choices: z.array(scalarSchema).optional(),
      fields: z.record(identifier, parameterSchema).optional(),
      items: parameterSchema.optional(),
      override: z.enum(["replace", "merge"]).default("replace"),
    })
    .superRefine((definition, context) => {
      if (
        definition.minimum !== undefined &&
        definition.maximum !== undefined &&
        definition.minimum > definition.maximum
      )
        context.addIssue({ code: "custom", message: "Parameter bounds must be ordered." });
      validateParameterShape(definition, context);
    })
);
export type ParameterDefinitions = Record<string, ParameterDefinition>;
export type ParameterValues = Record<string, Value>;

export const resourceSchema = z.object({
  id: identifier,
  kind: z.enum(["field", "vector", "network", "entities", "history", "value"]),
  schemaId: identifier,
  schemaVersion: z.number().int().positive(),
  revision: identifier,
  scope: scopeSchema,
  unit: identifier,
  facts: z.array(identifier),
  lineage: z.array(identifier),
});
export type ResourceReference = z.infer<typeof resourceSchema>;
export interface ResourceType<T> {
  id: string;
  version: number;
  kind: ResourceReference["kind"];
  schema: z.ZodType<T>;
}
