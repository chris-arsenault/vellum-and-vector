import { z } from "zod";
export declare const uuid: z.ZodUUID;
export declare const traitSchema: z.ZodObject<
  {
    field: z.ZodString;
    kind: z.ZodEnum<{
      exception: "exception";
      hard: "hard";
      tendency: "tendency";
      derived: "derived";
    }>;
    minimum: z.ZodNumber;
    maximum: z.ZodNumber;
    cause: z.ZodNullable<z.ZodString>;
    scope: z.ZodNullable<
      z.ZodType<
        import("geojson").Geometry,
        unknown,
        z.core.$ZodTypeInternals<import("geojson").Geometry, unknown>
      >
    >;
  },
  z.core.$strip
>;
export declare const relationSchema: z.ZodObject<
  {
    targetId: z.ZodUUID;
    kind: z.ZodString;
  },
  z.core.$strip
>;
export declare const featureInputSchema: z.ZodObject<
  {
    id: z.ZodUUID;
    name: z.ZodString;
    kind: z.ZodString;
    layerId: z.ZodString;
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
    attributes: z.ZodCustom<
      Record<string, import("./schemas").Value>,
      Record<string, import("./schemas").Value>
    >;
    relations: z.ZodDefault<
      z.ZodArray<
        z.ZodObject<
          {
            targetId: z.ZodUUID;
            kind: z.ZodString;
          },
          z.core.$strip
        >
      >
    >;
    protected: z.ZodOptional<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const entityInputSchema: z.ZodObject<
  {
    id: z.ZodUUID;
    name: z.ZodString;
    kind: z.ZodString;
    attributes: z.ZodCustom<
      Record<string, import("./schemas").Value>,
      Record<string, import("./schemas").Value>
    >;
    relations: z.ZodDefault<
      z.ZodArray<
        z.ZodObject<
          {
            targetId: z.ZodUUID;
            kind: z.ZodString;
          },
          z.core.$strip
        >
      >
    >;
  },
  z.core.$strip
>;
export declare const layerInputSchema: z.ZodObject<
  {
    id: z.ZodString;
    name: z.ZodString;
    family: z.ZodString;
    representation: z.ZodEnum<{
      field: "field";
      vector: "vector";
      network: "network";
    }>;
    color: z.ZodString;
    profiles: z.ZodArray<
      z.ZodEnum<{
        world: "world";
        region: "region";
        local: "local";
        site: "site";
        interior: "interior";
      }>
    >;
    schema: z.ZodCustom<
      Record<string, import("./schemas").Value>,
      Record<string, import("./schemas").Value>
    >;
    generator: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    representations: z.ZodOptional<
      z.ZodArray<
        z.ZodEnum<{
          field: "field";
          vector: "vector";
          network: "network";
        }>
      >
    >;
    facts: z.ZodOptional<z.ZodArray<z.ZodString>>;
  },
  z.core.$strip
>;
export declare const createAreaSchema: z.ZodObject<
  {
    id: z.ZodUUID;
    regionId: z.ZodOptional<z.ZodUUID>;
    parentId: z.ZodUUID;
    name: z.ZodString;
    profile: z.ZodEnum<{
      world: "world";
      region: "region";
      local: "local";
      site: "site";
      interior: "interior";
    }>;
    footprint: z.ZodType<
      import("geojson").Geometry,
      unknown,
      z.core.$ZodTypeInternals<import("geojson").Geometry, unknown>
    >;
    frame: z.ZodObject<
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
    approach: z.ZodEnum<{
      manual: "manual";
      blank: "blank";
      procedural: "procedural";
    }>;
    layers: z.ZodArray<z.ZodString>;
    traits: z.ZodDefault<
      z.ZodArray<
        z.ZodObject<
          {
            field: z.ZodString;
            kind: z.ZodEnum<{
              exception: "exception";
              hard: "hard";
              tendency: "tendency";
              derived: "derived";
            }>;
            minimum: z.ZodNumber;
            maximum: z.ZodNumber;
            cause: z.ZodNullable<z.ZodString>;
            scope: z.ZodNullable<
              z.ZodType<
                import("geojson").Geometry,
                unknown,
                z.core.$ZodTypeInternals<import("geojson").Geometry, unknown>
              >
            >;
          },
          z.core.$strip
        >
      >
    >;
    context: z.ZodDefault<z.ZodString>;
    contextFeatureId: z.ZodDefault<z.ZodNullable<z.ZodUUID>>;
    createEntrance: z.ZodDefault<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const setLayerStateSchema: z.ZodObject<
  {
    areaId: z.ZodUUID;
    layerId: z.ZodString;
    state: z.ZodEnum<{
      unmaterialized: "unmaterialized";
      generated: "generated";
      authored: "authored";
      protected: "protected";
      intentionallyEmpty: "intentionallyEmpty";
      stale: "stale";
    }>;
  },
  z.core.$strip
>;
