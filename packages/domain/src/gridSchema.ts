import { z } from "zod";
import { finite, geometrySchema, identifier, positionSchema, scopeSchema } from "./schemas";
import type { Grid } from "./grids";
import { adaptiveTopologySchema } from "./adaptiveSchema";
import { biomeInputs } from "./biomeField";
import {
  numericChannelSchema,
  preparedFieldSchema,
  preparedChannelSchema,
  fieldMeshSchema,
} from "./preparedSchema";

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
    channels: z.record(identifier, numericChannelSchema),
    units: z.record(identifier, identifier),
    quantities: z.record(identifier, z.enum(["intensive", "extensive", "category"])).optional(),
    waterBodies: z.array(bodySchema).nullable().optional(),
    ocean: geometrySchema.nullable().optional(),
    prepared: preparedFieldSchema.optional(),
    geography: z
      .object({
        provinces: z
          .record(
            identifier,
            z
              .object({
                partition: z
                  .object({
                    origin: z.tuple([finite, finite]),
                    seed: finite,
                    scale: finite.positive(),
                    strength: finite,
                    sites: z
                      .array(
                        z.object({
                          x: finite,
                          y: finite,
                          priority: finite,
                          assembly: finite,
                          motionX: finite,
                          motionY: finite,
                        })
                      )
                      .min(1),
                    regions: z.array(
                      z.object({ province: finite.int().nonnegative(), footprint: geometrySchema })
                    ),
                  })
                  .superRefine((partition, context) => {
                    if (
                      partition.regions.some((region) => region.province >= partition.sites.length)
                    )
                      context.addIssue({
                        code: "custom",
                        message: "Province regions require a corresponding site.",
                      });
                  }),
                values: z.array(finite),
              })
              .refine(
                (binding) => binding.values.length === binding.partition.sites.length,
                "Province channel values must match the site count."
              )
          )
          .optional(),
        categories: z
          .record(
            identifier,
            z.object({
              fallback: finite,
              entries: z.array(z.object({ code: finite, footprint: geometrySchema })),
            })
          )
          .optional(),
        occurrences: z
          .record(
            identifier,
            z.array(z.object({ epoch: finite.int().nonnegative(), footprint: geometrySchema }))
          )
          .optional(),
        water: preparedChannelSchema
          .extend({
            elevation: numericChannelSchema,
            bodyIds: numericChannelSchema,
            seaLevel: finite,
            lakes: z.array(z.object({ id: finite, footprint: geometrySchema, level: finite })),
          })
          .optional(),
        biome: z
          .object({
            values: z.record(identifier, numericChannelSchema),
            prepared: z.record(identifier, preparedChannelSchema),
            seaLevel: finite,
            lakes: z.array(z.object({ footprint: geometrySchema, level: finite })),
            protectedMask: z.instanceof(Uint8Array),
            protectedCodes: numericChannelSchema,
            protectedRegions: z
              .array(z.object({ code: z.number().int(), footprint: geometrySchema }))
              .optional(),
            codes: z.array(z.number().int().nonnegative()),
          })
          .optional(),
      })
      .optional(),
  })
  .strict();
export const gridSchema: z.ZodType<Grid> = z
  .union([
    fieldSchema.extend({ width: z.number().int().min(2), height: z.number().int().min(2) }),
    fieldSchema.extend({ topology: adaptiveTopologySchema }),
    fieldSchema.extend({ mesh: fieldMeshSchema }),
  ])
  .superRefine((grid, context) => {
    const count =
      "mesh" in grid
        ? grid.mesh.x.length
        : "topology" in grid
          ? grid.topology.leaves.length
          : grid.width * grid.height;
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
    if (grid.prepared) {
      for (const [name, coefficients] of Object.entries(grid.prepared.coefficients))
        if (coefficients.dx.length !== count || coefficients.dy.length !== count)
          context.addIssue({
            code: "custom",
            message: `Prepared derivatives for ${name} must match support.`,
          });
      for (const [name, field] of Object.entries(grid.prepared.adaptive ?? {}))
        if (
          field.cells.length !== field.topology.leaves.length ||
          field.cells.some(
            (cell) => cell.coefficients.length !== 16 || cell.bernstein.length !== 25
          )
        )
          context.addIssue({
            code: "custom",
            message: `Prepared adaptive patches for ${name} must match topology.`,
          });
    }
    const biome = grid.geography?.biome,
      water = grid.geography?.water;
    if (
      biome &&
      (biome.protectedCodes.length !== count ||
        biome.protectedMask.length !== count ||
        [...biomeInputs, "elevation"].some((name) => biome.values[name]?.length !== count))
    )
      context.addIssue({
        code: "custom",
        message: "Biome fields require complete environment and protection samples.",
      });
    if (water && (water.elevation.length !== count || water.bodyIds.length !== count))
      context.addIssue({
        code: "custom",
        message: "Water fields require matching floor and identity samples.",
      });
  });
