import { z } from "zod";

import type { Style } from "geostyler-style";

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
