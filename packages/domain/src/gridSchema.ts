import { z } from "zod";
import {
  finite,
  geometrySchema,
  identifier,
  positionSchema,
  scopeSchema,
  type ResourceType,
} from "./schemas";
import type { Grid } from "./grids";

const channel = z
  .instanceof(Float64Array)
  .refine((values) => values.every(Number.isFinite), "Numerical channels require finite samples.");
const bodySchema = z.object({
  id: identifier,
  footprint: geometrySchema,
  slices: z.array(
    z.object({
      floor: finite,
      area: finite.nonnegative(),
      footprint: geometrySchema.nullable(),
      sediment: finite,
    })
  ),
  volume: finite,
  spill: finite,
  outlet: positionSchema.nullable(),
  outletFrom: positionSchema.nullable(),
  suspended: finite,
  fixedLevel: finite.nullable(),
  outletPath: z.array(positionSchema).nullable(),
});

export const gridSchema: z.ZodType<Grid> = z
  .object({
    id: identifier,
    scope: scopeSchema,
    bounds: z.tuple([finite, finite, finite, finite]),
    width: z.number().int().min(2),
    height: z.number().int().min(2),
    active: z.instanceof(Uint8Array).refine((values) => values.every((value) => value <= 1)),
    measures: channel.refine((values) => values.every((value) => value >= 0)),
    channels: z.record(identifier, channel),
    units: z.record(identifier, identifier),
    waterBodies: z.array(bodySchema).nullable().optional(),
  })
  .strict()
  .superRefine((grid, context) => {
    const count = grid.width * grid.height;
    if (grid.bounds[0] >= grid.bounds[2] || grid.bounds[1] >= grid.bounds[3])
      context.addIssue({ code: "custom", message: "Grid bounds must have positive area." });
    if (grid.active.length !== count || grid.measures.length !== count)
      context.addIssue({
        code: "custom",
        message: "Grid masks and measures must match dimensions.",
      });
    for (const [name, values] of Object.entries(grid.channels)) {
      if (values.length !== count)
        context.addIssue({ code: "custom", message: `Channel ${name} must match dimensions.` });
      if (!Object.hasOwn(grid.units, name))
        context.addIssue({ code: "custom", message: `Channel ${name} requires declared units.` });
    }
  });

export const gridType: ResourceType<Grid> = {
  id: "atlas.grid",
  version: 1,
  kind: "field",
  schema: gridSchema,
};
