import { z } from "zod";
import { type ResourceType } from "./schemas";
export declare const candidateFeatureSchema: z.ZodObject<
  {
    id: z.ZodString;
    areaId: z.ZodString;
    layerId: z.ZodString;
    name: z.ZodString;
    kind: z.ZodString;
    geometry: z.ZodType<
      import("geojson").Geometry,
      unknown,
      z.core.$ZodTypeInternals<import("geojson").Geometry, unknown>
    >;
    footprint: z.ZodOptional<
      z.ZodType<
        import("geojson").Geometry,
        unknown,
        z.core.$ZodTypeInternals<import("geojson").Geometry, unknown>
      >
    >;
    state: z.ZodEnum<{
      unmaterialized: "unmaterialized";
      generated: "generated";
      authored: "authored";
      protected: "protected";
      intentionallyEmpty: "intentionallyEmpty";
      stale: "stale";
    }>;
    protected: z.ZodBoolean;
    actor: z.ZodString;
    attributes: z.ZodCustom<
      Record<string, import("./schemas").Value>,
      Record<string, import("./schemas").Value>
    >;
    causes: z.ZodArray<z.ZodString>;
    relations: z.ZodArray<
      z.ZodObject<
        {
          targetId: z.ZodString;
          kind: z.ZodString;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const candidateEntitySchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodString;
    kind: z.ZodString;
    state: z.ZodEnum<{
      unmaterialized: "unmaterialized";
      generated: "generated";
      authored: "authored";
      protected: "protected";
      intentionallyEmpty: "intentionallyEmpty";
      stale: "stale";
    }>;
    attributes: z.ZodCustom<
      Record<string, import("./schemas").Value>,
      Record<string, import("./schemas").Value>
    >;
    relations: z.ZodArray<
      z.ZodObject<
        {
          targetId: z.ZodString;
          kind: z.ZodString;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const networkSchema: z.ZodObject<
  {
    nodes: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          kind: z.ZodString;
          spaceId: z.ZodString;
          position: z.ZodObject<
            {
              x: z.ZodNumber;
              y: z.ZodNumber;
              z: z.ZodNumber;
            },
            z.core.$strip
          >;
          waterLevel: z.ZodNullable<z.ZodNumber>;
        },
        z.core.$strip
      >
    >;
    reaches: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          featureId: z.ZodString;
          start: z.ZodString;
          end: z.ZodString;
          geometry: z.ZodType<
            import("geojson").Geometry,
            unknown,
            z.core.$ZodTypeInternals<import("geojson").Geometry, unknown>
          >;
          flow: z.ZodNumber;
          endFlow: z.ZodNullable<z.ZodNumber>;
        },
        z.core.$strip
      >
    >;
    connections: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          kind: z.ZodString;
          flow: z.ZodNumber;
          a: z.ZodObject<
            {
              nodeId: z.ZodOptional<z.ZodString>;
              areaId: z.ZodString;
              position: z.ZodObject<
                {
                  x: z.ZodNumber;
                  y: z.ZodNumber;
                  z: z.ZodNumber;
                },
                z.core.$strip
              >;
              featureId: z.ZodNullable<z.ZodString>;
            },
            z.core.$strip
          >;
          b: z.ZodObject<
            {
              nodeId: z.ZodOptional<z.ZodString>;
              areaId: z.ZodString;
              position: z.ZodObject<
                {
                  x: z.ZodNumber;
                  y: z.ZodNumber;
                  z: z.ZodNumber;
                },
                z.core.$strip
              >;
              featureId: z.ZodNullable<z.ZodString>;
            },
            z.core.$strip
          >;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export declare const historySchema: z.ZodObject<
  {
    epochId: z.ZodString;
    duration: z.ZodNumber;
    parentEpoch: z.ZodNullable<z.ZodString>;
    parentResource: z.ZodNullable<z.ZodString>;
    previousResource: z.ZodNullable<z.ZodString>;
    events: z.ZodArray<
      z.ZodObject<
        {
          id: z.ZodString;
          kind: z.ZodString;
          subjectId: z.ZodNullable<z.ZodString>;
          epochId: z.ZodString;
          position: z.ZodObject<
            {
              x: z.ZodNumber;
              y: z.ZodNumber;
              z: z.ZodNumber;
            },
            z.core.$strip
          >;
          amount: z.ZodNumber;
          unit: z.ZodString;
          causes: z.ZodArray<z.ZodString>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export type CandidateFeature = z.infer<typeof candidateFeatureSchema>;
export type CandidateEntity = z.infer<typeof candidateEntitySchema>;
export type NetworkPayload = z.infer<typeof networkSchema>;
export type HistoryPayload = z.infer<typeof historySchema>;
export declare const featuresType: ResourceType<CandidateFeature[]>;
export declare const entitiesType: ResourceType<CandidateEntity[]>;
export declare const networkType: ResourceType<NetworkPayload>;
export declare const historyType: ResourceType<HistoryPayload>;
