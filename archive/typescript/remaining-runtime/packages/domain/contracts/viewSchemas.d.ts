import { z } from "zod";
import type { Style } from "geostyler-style";
export declare const symbolStyleSchema: z.ZodPipe<
  z.ZodObject<
    {
      name: z.ZodString;
      rules: z.ZodArray<
        z.ZodObject<
          {
            name: z.ZodString;
            symbolizers: z.ZodArray<
              z.ZodObject<
                {
                  kind: z.ZodString;
                },
                z.core.$loose
              >
            >;
          },
          z.core.$loose
        >
      >;
    },
    z.core.$loose
  >,
  z.ZodTransform<
    Style,
    {
      [x: string]: unknown;
      name: string;
      rules: {
        [x: string]: unknown;
        name: string;
        symbolizers: {
          [x: string]: unknown;
          kind: string;
        }[];
      }[];
    }
  >
>;
export declare const rasterPresentationSchema: z.ZodObject<
  {
    base: z.ZodEnum<{
      relief: "relief";
      surface: "surface";
      topographic: "topographic";
    }>;
    sunAzimuth: z.ZodNumber;
    sunElevation: z.ZodNumber;
    exaggeration: z.ZodNumber;
    contourInterval: z.ZodNumber;
    fields: z.ZodArray<
      z.ZodObject<
        {
          channel: z.ZodString;
          visible: z.ZodBoolean;
          opacity: z.ZodNumber;
          palette: z.ZodEnum<{
            terrain: "terrain";
            viridis: "viridis";
            magma: "magma";
            blueRed: "blueRed";
          }>;
          scale: z.ZodEnum<{
            linear: "linear";
            log: "log";
          }>;
          range: z.ZodNullable<z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
