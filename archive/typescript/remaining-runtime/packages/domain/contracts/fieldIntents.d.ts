import { z } from "zod";
import { type IntentContext, type IntentRegistry } from "./intent";
import type { DomainSnapshot, ChangeSet } from "./operations";
export declare const createFieldSchema: z.ZodObject<
  {
    id: z.ZodUUID;
    areaId: z.ZodUUID;
    layerId: z.ZodString;
    footprint: z.ZodType<
      import("geojson").Geometry,
      unknown,
      z.core.$ZodTypeInternals<import("geojson").Geometry, unknown>
    >;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
    topology: z.ZodOptional<
      z.ZodType<
        import("./adaptiveTopology").AdaptiveTopology,
        unknown,
        z.core.$ZodTypeInternals<import("./adaptiveTopology").AdaptiveTopology, unknown>
      >
    >;
    channels: z.ZodRecord<
      z.ZodString,
      z.ZodObject<
        {
          unit: z.ZodString;
          values: z.ZodUnion<readonly [z.ZodNumber, z.ZodArray<z.ZodNumber>]>;
        },
        z.core.$strip
      >
    >;
    parentFieldId: z.ZodOptional<z.ZodUUID>;
  },
  z.core.$strip
>;
export type CreateField = z.infer<typeof createFieldSchema>;
export declare function createField(
  data: CreateField,
  context: IntentContext,
  snapshot: DomainSnapshot,
  reconcile?: boolean
): ChangeSet;
export declare function registerFieldIntents(registry: IntentRegistry): void;
