import { z } from "zod";
import type { Area } from "./model";
export declare const worldCreationSchema: z.ZodObject<
  {
    id: z.ZodUUID;
    name: z.ZodString;
    seed: z.ZodNumber;
    reference: z.ZodObject<
      {
        id: z.ZodString;
        domain: z.ZodType<
          import("geojson").Geometry,
          unknown,
          z.core.$ZodTypeInternals<import("geojson").Geometry, unknown>
        >;
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
    rootId: z.ZodOptional<z.ZodUUID>;
    rootName: z.ZodDefault<z.ZodString>;
    frame: z.ZodOptional<
      z.ZodObject<
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
      >
    >;
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
    layers: z.ZodOptional<
      z.ZodArray<
        z.ZodObject<
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
        >
      >
    >;
  },
  z.core.$strip
>;
export declare function createWorldBlueprint(input: unknown): {
  id: string;
  name: string;
  seed: number;
  reference: {
    domain: import("geojson").Geometry;
    id: string;
    topology: "planar";
    boundaryMode: "cylinder" | "ocean" | "none";
    units: "metre";
    axes: "east,north,up";
    verticalDatum: string;
    version: number;
    precision: number;
  };
  root: Area;
  layers: import("./model").Layer[];
};
