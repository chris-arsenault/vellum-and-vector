import { z } from "zod";
import type { Style } from "geostyler-style";
import { finite } from "./schemas";

// Symbolizer details belong to GeoStyler. Keep its rule tree intact in session views.
export const symbolStyleSchema = z
  .object({
    name: z.string(),
    rules: z.array(
      z
        .object({
          name: z.string(),
          symbolizers: z.array(z.object({ kind: z.string() }).passthrough()),
        })
        .passthrough()
    ),
  })
  .passthrough()
  .transform((value) => value as Style);

export const rasterPresentationSchema = z.object({
  base: z.enum(["surface", "topographic", "relief"]),
  sunAzimuth: finite.min(0).max(360),
  sunElevation: finite.min(1).max(90),
  exaggeration: finite.min(0).max(20),
  contourInterval: finite.positive(),
  fields: z.array(
    z.object({
      channel: z.string().min(1),
      visible: z.boolean(),
      opacity: finite.min(0).max(1),
      palette: z.enum(["viridis", "magma", "blueRed", "terrain"]),
      scale: z.enum(["linear", "log"]),
      range: z
        .tuple([finite, finite])
        .refine(([min, max]) => max > min, "The upper range must exceed the lower range.")
        .nullable(),
    })
  ),
});
