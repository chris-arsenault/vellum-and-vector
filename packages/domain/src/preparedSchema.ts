import { z } from "zod";
import { finite, identifier } from "./schemas";
import { adaptiveTopologySchema } from "./adaptiveSchema";

export const numericChannelSchema = z
  .union([
    z.instanceof(Float64Array),
    z.instanceof(Float32Array),
    z.instanceof(Int32Array),
    z.instanceof(Uint8Array),
  ])
  .refine((values) => values.every(Number.isFinite), "Numerical channels require finite samples.");
const doubles = z.instanceof(Float64Array).refine((values) => values.every(Number.isFinite));
export const supportSchema = z.object({
  x: doubles,
  y: doubles,
  origin: z.tuple([finite, finite]),
  spacing: finite.positive(),
});
const coefficients = z.object({ dx: doubles, dy: doubles, affine: z.boolean() });
const adaptive = z.object({
  topology: adaptiveTopologySchema,
  cells: z.array(
    z.object({
      coefficients: doubles,
      correction: finite,
      bernstein: doubles,
      low: finite,
      high: finite,
    })
  ),
});
export const preparedChannelSchema = z.object({
  coefficients: coefficients.optional(),
  adaptive: adaptive.optional(),
  transform: z.object({ scale: finite, offset: finite }).optional(),
});
export const preparedFieldSchema = z.object({
  support: supportSchema,
  coefficients: z.record(identifier, coefficients),
  adaptive: z.record(identifier, adaptive).optional(),
  transforms: z.record(identifier, z.object({ scale: finite, offset: finite })),
});
export const fieldMeshSchema = supportSchema.extend({
  offsets: z.instanceof(Int32Array),
  neighbors: z.instanceof(Int32Array),
  cellBounds: doubles,
  adaptive: z
    .object({ topology: adaptiveTopologySchema, leafToSample: z.instanceof(Int32Array) })
    .optional(),
});
