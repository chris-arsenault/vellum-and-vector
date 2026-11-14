import { z } from "zod";
import { type ReadRequirements } from "./operations";
export declare const pageSchema: z.ZodObject<
  {
    offset: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodNumber;
  },
  z.core.$strip
>;
export declare const readRequirementsSchema: z.ZodType<ReadRequirements>;
export declare const spatialQuerySchema: z.ZodObject<
  {
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
    layers: z.ZodDefault<z.ZodArray<z.ZodString>>;
    page: z.ZodObject<
      {
        offset: z.ZodDefault<z.ZodNumber>;
        limit: z.ZodNumber;
      },
      z.core.$strip
    >;
  },
  z.core.$strip
>;
