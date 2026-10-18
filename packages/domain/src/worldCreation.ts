import { z } from "zod";
import { referenceSchema, frameSchema } from "./schemas";
import { uuid, layerInputSchema, traitSchema } from "./authoringSchemas";
import { builtinLayers } from "./builtinLayers";
import { Spatial } from "./spatial";
import { semanticId } from "./identity";
import { geometryParts } from "./composition";
import { requireThat } from "./errors";
import { validateAreaPlacement } from "./areaConstraints";
import { validateLayerChange } from "./layerAttributes";
import type { Area } from "./model";

export const worldCreationSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1),
  seed: z.number().int().min(-2147483648).max(2147483647),
  reference: referenceSchema,
  rootId: uuid.optional(),
  rootName: z.string().trim().min(1).default("World"),
  frame: frameSchema.optional(),
  traits: z.array(traitSchema).default([]),
  layers: z.array(layerInputSchema).optional(),
});
export function createWorldBlueprint(input: unknown) {
  const data = worldCreationSchema.parse(input),
    gis = new Spatial(data.reference.precision),
    footprint = gis.canonical(data.reference.domain),
    parts = geometryParts(footprint);
  requireThat(
    parts.every((p) => p.type === "Polygon"),
    "world_domain",
    "A world reference uses a polygonal planar domain."
  );
  const first = parts[0];
  requireThat(
    first.type === "Polygon",
    "world_domain",
    "A world domain needs polygonal geographic coverage."
  );
  const origin = first.coordinates[0][0];
  const root: Area = {
    id: data.rootId ?? semanticId(data.id, "area", "root"),
    name: data.rootName,
    parentId: null,
    profile: "world",
    footprint,
    frame: data.frame ?? {
      origin: { x: origin[0], y: origin[1], z: 0 },
      rotation: 0,
      metresPerUnit: 1,
      floor: null,
    },
    spaceId: data.id,
    version: 1,
    traits: data.traits,
    localTraits: data.traits,
    layers: {},
    boundary: null,
    templateId: null,
    templateInstanceId: null,
    recipeJobId: null,
    contextFeatureId: null,
    context: "landscape",
  };
  const reference = { ...data.reference, domain: footprint },
    layers = data.layers ?? builtinLayers();
  requireThat(
    new Set(layers.map((l) => l.id)).size === layers.length,
    "duplicate_layer",
    "Each world layer has one registered identity."
  );
  for (const layer of layers) validateLayerChange(undefined, layer, [], 0);
  validateAreaPlacement({ id: data.id, reference, areas: {} }, root);
  return { id: data.id, name: data.name, seed: data.seed, reference, root, layers };
}
