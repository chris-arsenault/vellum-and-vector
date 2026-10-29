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
import { adaptiveTopologySchema } from "./adaptiveSchema";
import { numericalSchema } from "./numericalSchema";
import { Coverage } from "./lattice/coverage";
import { everySample } from "./lattice/bandValues";

const channel = numericalSchema("float64").refine(
  (values) => everySample(values, Number.isFinite),
  "Numerical channels require finite samples."
);
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

const fieldSchema = z
  .object({
    id: identifier,
    periodicWidth: finite.positive().optional(),
    scope: scopeSchema,
    bounds: z.tuple([finite, finite, finite, finite]),
    coverage: z.custom<Coverage>((value) => value instanceof Coverage),
    active: numericalSchema("uint8").refine((values) => everySample(values, (v) => v <= 1)),
    measures: channel.refine((values) => everySample(values, (v) => v >= 0)),
    channels: z.record(identifier, channel),
    units: z.record(identifier, identifier),
    quantities: z.record(identifier, z.enum(["intensive", "extensive", "category"])).optional(),
    waterBodies: z.array(bodySchema).nullable().optional(),
    lakes: z.array(z.object({ id: identifier, geometry: geometrySchema, level: finite })).optional(),
    ocean: geometrySchema.nullable().optional(),
  })
  .strict();
export const gridSchema: z.ZodType<Grid> = z
  .union([
    fieldSchema.extend({ width: z.number().int().min(2), height: z.number().int().min(2) }),
    fieldSchema.extend({ topology: adaptiveTopologySchema }),
  ])
  .superRefine((grid, context) => {
    const count = "topology" in grid ? grid.topology.leaves.length : grid.width * grid.height;
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
