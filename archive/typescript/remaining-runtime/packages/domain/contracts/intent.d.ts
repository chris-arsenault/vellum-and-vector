import { z } from "zod";
import { type SpatialScope, type ParameterValues } from "./schemas";
import type { ChangeSet, DomainSnapshot, ReadRequirements } from "./operations";
import type { FieldRef, Layer } from "./model";
import type { FactDependencies } from "./factDependencies";
import type { BlockCache } from "./lattice/blockCache";
export declare const intentSchema: z.ZodObject<
  {
    operationId: z.ZodUUID;
    expectedVersion: z.ZodNumber;
    version: z.ZodDefault<z.ZodNumber>;
    kind: z.ZodString;
    scope: z.ZodObject<
      {
        footprint: z.ZodType<
          import("geojson").Geometry,
          unknown,
          z.core.$ZodTypeInternals<import("geojson").Geometry, unknown>
        >;
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
    data: z.ZodCustom<
      Record<string, import("./schemas").Value>,
      Record<string, import("./schemas").Value>
    >;
    confirmed: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export type Intent = z.infer<typeof intentSchema>;
export interface IntentContext {
  /** Block cache that grids created by the intent page through; resident when absent. */
  blocks?: BlockCache;
  owner: string;
  actor: string;
  operationId: string;
  scope: SpatialScope;
  layers: Layer[];
  fields: FieldRef[];
  facts: FactDependencies;
  introducedIds?: string[];
}
export interface IntentDefinition<T> {
  kind: string;
  version: number;
  description: string;
  schema: z.ZodType<T>;
  requirements(data: T, context: IntentContext): ReadRequirements;
  evaluate(data: T, context: IntentContext, snapshot: DomainSnapshot): ChangeSet;
}
export interface BoundIntent {
  kind: string;
  version: number;
  parameters: ParameterValues;
  requirements: ReadRequirements;
  evaluate(snapshot: DomainSnapshot): ChangeSet;
}
export declare class IntentRegistry {
  private readonly definitions;
  register<T>(definition: IntentDefinition<T>): this;
  bind(input: Intent, context: IntentContext): BoundIntent;
  describe(): {
    kind: string;
    version: number;
    description: string;
    schema: z.core.ZodStandardJSONSchemaPayload<
      z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>
    >;
  }[];
}
export declare function intentReads(
  context: IntentContext,
  selection?: Partial<Omit<ReadRequirements, "scope">>
): ReadRequirements;
export declare function intentChanges(context: IntentContext, snapshot: DomainSnapshot): ChangeSet;
