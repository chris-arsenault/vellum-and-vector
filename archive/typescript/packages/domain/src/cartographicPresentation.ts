import { z } from "zod";
import { finite } from "./schemas";

const coordinate = z.tuple([finite, finite]);
export const cartographicMarkSchema = z.enum([
  "auto",
  "town",
  "castle",
  "ruin",
  "tree",
  "mountain",
]);
export const cartographicOverrideSchema = z.object({
  hidden: z.boolean().optional(),
  illustrationHidden: z.boolean().optional(),
  labelHidden: z.boolean().optional(),
  symbol: cartographicMarkSchema.optional(),
  anchor: coordinate.optional(),
  path: z.array(coordinate).min(2).optional(),
  offsetX: finite.optional(),
  offsetY: finite.optional(),
  rotation: finite.optional(),
  size: finite.positive().optional(),
});
export const cartographicPresentationSchema = z.object({
  mode: z.enum(["raster", "drawn"]),
  style: z.enum(["wash", "ink"]),
  subject: z.enum(["physical", "political", "cultural", "infrastructure"]),
  terrain: z.boolean(),
  clip: z.boolean(),
  labels: z.boolean(),
  density: finite.min(0.5).max(2),
  fields: z.array(z.string()),
  overrides: z.record(z.string(), cartographicOverrideSchema),
  sheet: z.object({
    title: z.string(),
    subtitle: z.string(),
    frame: z.boolean(),
    legend: z.boolean(),
    compass: z.boolean(),
    scale: z.boolean(),
  }),
});
export type CartographicPresentation = z.infer<typeof cartographicPresentationSchema>;
export type CartographicOverride = z.infer<typeof cartographicOverrideSchema>;
export type CartographicMark = z.infer<typeof cartographicMarkSchema>;

export function defaultCartographicPresentation(): CartographicPresentation {
  return {
    mode: "raster",
    style: "wash",
    subject: "political",
    terrain: true,
    clip: true,
    labels: true,
    density: 1,
    fields: [],
    overrides: {},
    sheet: { title: "", subtitle: "", frame: true, legend: true, compass: true, scale: true },
  };
}
