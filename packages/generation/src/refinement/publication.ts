import { builtinLayers, type Layer } from "@atlas/domain";
import type { PublicationDefinition } from "../publication";
import { generationFeatures } from "../generationFeatures";
import type { RefinementState } from "./state";

const layers: Record<string, string[]> = {
  elevation: ["elevation"],
  geology: [
    "geothermal",
    "rock",
    "fracture",
    "margin",
    "glacialErosion",
    "sediment",
    "slope",
    "erosion",
    "naturalSurface",
    "finalSurface",
    "secondSurface",
    "physicalMaterial",
  ],
  climate: [
    "temperature",
    "naturalTemperature",
    "moisture",
    "rainfall",
    "snowfall",
    "windEast",
    "windNorth",
    "seaDatum",
    "ice",
  ],
  rivers: [
    "runoff",
    "flow",
    "catchmentArea",
    "water",
    "waterLevel",
    "seaLevel",
    "waterDepth",
    "drainageElevation",
    "riverOrder",
  ],
  ecology: [
    "soilDepth",
    "soilCarbon",
    "mineralNutrients",
    "treeCover",
    "grassCover",
    "wetlandCover",
    "biome",
    "productivity",
  ],
};
function publicationLayer(state: RefinementState, id: string): Layer {
  const base = state.domain.world.layers[id] ?? builtinLayers().find((l) => l.id === id)!;
  return {
    ...base,
    representations: [
      ...new Set<NonNullable<Layer["representations"]>[number]>([
        ...(base.representations ?? []),
        ...(base.representation === "network" ? ["network" as const] : []),
        "field" as const,
        "vector" as const,
      ]),
    ],
  };
}
export function refinementPublications(state: RefinementState): PublicationDefinition[] {
  const definitions: PublicationDefinition[] = [],
    registered = new Map<string, Layer>();
  const layer = (id: string) => {
    if (!registered.has(id)) registered.set(id, publicationLayer(state, id));
    return registered.get(id)!;
  };
  for (const [name, unit] of Object.entries(state.surface.units)) {
    if (!state.input.domains.some((id) => id === "physical" || id === "magic")) continue;
    const id = Object.entries(layers).find(([, names]) => names.includes(name))?.[0] ?? "magic";
    definitions.push({
      kind: "field",
      channel: name,
      unit,
      quantity: state.surface.quantities?.[name] ?? "intensive",
      layer: layer(id),
    });
  }
  const kinds = new Map<string, Set<string>>();
  for (const f of generationFeatures(state, { areaId: state.input.areaId })) {
    if (!kinds.has(f.layerId)) kinds.set(f.layerId, new Set());
    kinds.get(f.layerId)!.add(f.kind);
  }
  for (const [id, values] of kinds)
    definitions.push({ kind: "geography", layer: layer(id), featureKinds: [...values] });
  return definitions;
}
