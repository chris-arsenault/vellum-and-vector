import { z } from "zod";
import { durableScopeSchema, identifier } from "./schemas";
import { objectKinds, type ReadRequirements } from "./operations";

export const pageSchema = z.object({
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive(),
});
export const readRequirementsSchema: z.ZodType<ReadRequirements> = z.object({
  scope: durableScopeSchema,
  objects: z
    .array(
      z
        .object({ kind: z.enum(objectKinds), ids: z.array(identifier) })
        .superRefine((selection, context) => {
          if (selection.kind === "layer") return;
          for (const [index, id] of selection.ids.entries())
            if (!z.uuid().safeParse(id).success)
              context.addIssue({
                code: "custom",
                path: ["ids", index],
                message: "Persistent object IDs must be UUIDs.",
              });
        })
    )
    .default([]),
  spatialLayers: z.array(identifier).default([]),
  channels: z
    .array(
      z.object({
        fieldId: z.uuid(),
        names: z.array(identifier),
        haloCells: z.number().int().nonnegative().optional(),
      })
    )
    .default([]),
  parentHistory: z.array(z.uuid()).default([]),
  dependencies: z.boolean().default(true),
  references: z.array(z.uuid()).optional(),
  referencesTo: z.array(z.uuid()).optional(),
  layerContents: z.array(identifier).optional(),
  completeRepresentations: z.array(z.uuid()).optional(),
  connected: z
    .object({ featureIds: z.array(z.uuid()), mode: z.enum(["network", "circulation"]) })
    .optional(),
  constraints: z
    .object({
      intersectingAreas: z.boolean(),
      descendantsOf: z.array(z.uuid()),
      boundaryFeatures: z.array(z.uuid()),
    })
    .optional(),
});
export const spatialQuerySchema = z.object({
  scope: durableScopeSchema,
  layers: z.array(identifier).default([]),
  page: pageSchema,
});
