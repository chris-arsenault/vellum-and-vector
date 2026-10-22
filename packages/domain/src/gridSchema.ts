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
import { biomeInputs } from "./biomeField";
import type { WaterSamples } from "./waterField";

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

const fieldSchema = z
  .object({
    id: identifier,
    scope: scopeSchema,
    bounds: z.tuple([finite, finite, finite, finite]),
    active: z.instanceof(Uint8Array).refine((values) => values.every((value) => value <= 1)),
    measures: channel.refine((values) => values.every((value) => value >= 0)),
    channels: z.record(identifier, channel),
    units: z.record(identifier, identifier),
    quantities: z.record(identifier, z.enum(["intensive", "extensive", "category"])).optional(),
    waterBodies: z.array(bodySchema).nullable().optional(),
    ocean: geometrySchema.nullable().optional(),
    reconstruction: z
      .object({
        support: z.object({
          x: channel,
          y: channel,
          origin: z.tuple([finite, finite]),
          spacing: finite.positive(),
        }),
        channels: z.record(identifier, channel),
        categories: z.record(identifier, channel).optional(),
        water: z
          .object({
            elevation: channel,
            bodyIds: channel,
            seaLevel: finite,
            lakes: z.array(z.object({ id: finite, footprint: geometrySchema, level: finite })),
          })
          .optional(),
        biome: z
          .object({
            values: z.record(identifier, channel),
            seaLevel: finite,
            lakes: z.array(z.object({ footprint: geometrySchema, level: finite })),
            protectedMask: z.instanceof(Uint8Array),
            protectedCodes: channel,
            codes: z.array(z.number().int().nonnegative()),
          })
          .optional(),
      })
      .superRefine((source, context) => {
        const count = source.support.x.length;
        if (
          !count ||
          source.support.y.length !== count ||
          Object.values({ ...source.channels, ...source.categories, ...source.biome?.values }).some(
            (values) => values.length !== count
          )
        )
          context.addIssue({
            code: "custom",
            message: "Reconstruction channels require shared finite sample support.",
          });
        if (
          source.biome &&
          (source.biome.protectedCodes.length !== count ||
            source.biome.protectedMask.length !== count ||
            [...biomeInputs, "elevation"].some((name) => !source.biome!.values[name]))
        )
          context.addIssue({
            code: "custom",
            message: "Biome reconstruction requires complete environment and protection samples.",
          });
        if (!waterCountsMatch(source.water, count))
          context.addIssue({
            code: "custom",
            message: "Water reconstruction requires matching floor and identity samples.",
          });
      })
      .optional(),
  })
  .strict();
function waterCountsMatch(water: WaterSamples | undefined, count: number) {
  return !water || (water.elevation.length === count && water.bodyIds.length === count);
}
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
