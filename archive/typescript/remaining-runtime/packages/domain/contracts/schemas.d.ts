import { z } from "zod";
import type { Geometry } from "geojson";
export declare const finite: z.ZodNumber;
export declare const identifier: z.ZodString;
export declare const positionSchema: z.ZodObject<
  {
    x: z.ZodNumber;
    y: z.ZodNumber;
    z: z.ZodNumber;
  },
  z.core.$strip
>;
export declare const frameSchema: z.ZodObject<
  {
    origin: z.ZodObject<
      {
        x: z.ZodNumber;
        y: z.ZodNumber;
        z: z.ZodNumber;
      },
      z.core.$strip
    >;
    rotation: z.ZodNumber;
    metresPerUnit: z.ZodNumber;
    floor: z.ZodNullable<z.ZodString>;
  },
  z.core.$strip
>;
export declare const geometrySchema: z.ZodType<Geometry>;
export declare const referenceSchema: z.ZodObject<
  {
    id: z.ZodString;
    domain: z.ZodType<Geometry, unknown, z.core.$ZodTypeInternals<Geometry, unknown>>;
    topology: z.ZodLiteral<"planar">;
    boundaryMode: z.ZodDefault<
      z.ZodEnum<{
        cylinder: "cylinder";
        ocean: "ocean";
        none: "none";
      }>
    >;
    units: z.ZodLiteral<"metre">;
    axes: z.ZodLiteral<"east,north,up">;
    verticalDatum: z.ZodString;
    version: z.ZodNumber;
    precision: z.ZodNumber;
  },
  z.core.$strip
>;
export declare const scopeSchema: z.ZodObject<
  {
    worldId: z.ZodString;
    areaId: z.ZodString;
    spaceId: z.ZodString;
    footprint: z.ZodType<Geometry, unknown, z.core.$ZodTypeInternals<Geometry, unknown>>;
    crsId: z.ZodString;
    revision: z.ZodNumber;
    time: z.ZodString;
    resolution: z.ZodNullable<z.ZodNumber>;
  },
  z.core.$strip
>;
export type SpatialScope = z.infer<typeof scopeSchema>;
export declare const durableScopeSchema: z.ZodObject<
  {
    footprint: z.ZodType<Geometry, unknown, z.core.$ZodTypeInternals<Geometry, unknown>>;
    crsId: z.ZodString;
    revision: z.ZodNumber;
    time: z.ZodString;
    resolution: z.ZodNullable<z.ZodNumber>;
    worldId: z.ZodUUID;
    areaId: z.ZodUUID;
    spaceId: z.ZodUUID;
  },
  z.core.$strip
>;
export declare const scalarSchema: z.ZodUnion<
  readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]
>;
export type Scalar = z.infer<typeof scalarSchema>;
export type Value =
  | Scalar
  | Value[]
  | {
      [key: string]: Value;
    };
export declare const valueSchema: z.ZodType<Value>;
export declare const valueRecordSchema: z.ZodCustom<Record<string, Value>, Record<string, Value>>;
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
export declare const parameterSchema: z.ZodType<ParameterDefinition>;
export type ParameterDefinitions = Record<string, ParameterDefinition>;
export type ParameterValues = Record<string, Value>;
export declare const resourceSchema: z.ZodObject<
  {
    id: z.ZodString;
    kind: z.ZodEnum<{
      value: "value";
      field: "field";
      vector: "vector";
      network: "network";
      entities: "entities";
      history: "history";
    }>;
    schemaId: z.ZodString;
    schemaVersion: z.ZodNumber;
    revision: z.ZodString;
    scope: z.ZodObject<
      {
        worldId: z.ZodString;
        areaId: z.ZodString;
        spaceId: z.ZodString;
        footprint: z.ZodType<Geometry, unknown, z.core.$ZodTypeInternals<Geometry, unknown>>;
        crsId: z.ZodString;
        revision: z.ZodNumber;
        time: z.ZodString;
        resolution: z.ZodNullable<z.ZodNumber>;
      },
      z.core.$strip
    >;
    unit: z.ZodString;
    facts: z.ZodArray<z.ZodString>;
    lineage: z.ZodArray<z.ZodString>;
  },
  z.core.$strip
>;
export type ResourceReference = z.infer<typeof resourceSchema>;
export interface ResourceType<T> {
  id: string;
  version: number;
  kind: ResourceReference["kind"];
  schema: z.ZodType<T>;
}
