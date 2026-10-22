import { z } from "zod";
import { gridSchema } from "./gridSchema";
import type { GridSurface } from "./grids";
import { identifier, type ResourceType } from "./schemas";

/** Validate each numerical field and the references/units of its composed inputs. */
export const gridSurfaceSchema: z.ZodType<GridSurface> = z.lazy(() =>
  z
    .object({
      overlays: z
        .array(
          z
            .object({
              grid: gridSurfaceSchema,
              channels: z.array(identifier),
              inherited: z.boolean().optional(),
            })
            .strict()
        )
        .optional(),
    })
    .passthrough()
    .transform(({ overlays, ...base }, context) => {
      const parsed = gridSchema.safeParse(base);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) context.addIssue({ ...issue });
        return z.NEVER;
      }
      const grid: GridSurface = parsed.data;
      for (const overlay of overlays ?? []) {
        const compatible =
          overlay.grid.scope.worldId === grid.scope.worldId &&
          overlay.grid.scope.spaceId === grid.scope.spaceId &&
          overlay.grid.scope.crsId === grid.scope.crsId &&
          overlay.channels.every(
            (name) =>
              grid.channels[name] &&
              overlay.grid.channels[name] &&
              grid.units[name] === overlay.grid.units[name]
          );
        if (!compatible)
          context.addIssue({
            code: "custom",
            message: "Composed fields retain their world, reference, channels and units.",
          });
      }
      if (overlays) grid.overlays = overlays;
      return grid;
    })
);

export const gridType: ResourceType<GridSurface> = {
  id: "atlas.grid",
  version: 1,
  kind: "field",
  schema: gridSurfaceSchema,
};
