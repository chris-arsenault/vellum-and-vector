import { MapScale, biomes } from "@atlas/domain";
import type { GenerationState } from "../process";
import type { BiomeSummary } from "./ecologyBiomes";
import { environment } from "./ecologyEnvironment";
import type { RegionMembers } from "./regionMembers";

type Term = (i: number) => number;
/** The biome family each ecology class belongs to: what a published landscape is a region of. */
export const families: Record<string, string> = {
  Barren: "barren",
  Desert: "barren",
  Tundra: "grassland",
  Grassland: "grassland",
  Savanna: "grassland",
  Woodland: "forest",
  "Temperate forest": "forest",
  "Boreal forest": "forest",
  Rainforest: "forest",
  Marsh: "wetland",
  Swamp: "wetland",
  "Ember grove": "ember",
  "Thaw meadow": "thaw",
  "Rime forest": "rime",
  "Glow-lichen barrens": "glow",
  "Fog heath": "fog",
  "Moss forest": "fog",
  Deepwood: "deepwood",
  "Barrow heath": "barrow",
  "Salt pan": "pan",
  "Glass flat": "flat",
  "Wending fen": "wending",
  "Well meadow": "well",
};
/** The family of a `BiomeCodes` value, or undefined for ice, water and the unclassified. */
export const biomeFamily = (code: number): string | undefined => families[biomes[code]?.name ?? ""];
/** A landscape's area-weighted means, which name it and fill its record. */
export function summarize(state: GenerationState, members: RegionMembers) {
  const map = state.physical!.map,
    area = (i: number) => map.mesh.area(i),
    total = members.reduce((sum, i) => sum + area(i), 0),
    mean = (value: Term) => members.reduce((sum, i) => sum + value(i) * area(i), 0) / total;
  const systems = new Map<string, number>();
  for (const field of state.physical!.magic?.fields ?? [])
    if (field.definition.enabled)
      systems.set(
        field.definition.id,
        mean((i) => field.intensity.get(i))
      );
  return {
    broadleaf: mean((i) => map.BroadleafCover.get(i)),
    conifer: mean((i) => map.ConiferCover.get(i)),
    grass: mean((i) => map.GrassCover.get(i)),
    wetland: mean((i) => map.WetlandCover.get(i)),
    fire: mean((i) => map.FireActivity.get(i)),
    flood: mean((i) => map.FloodFrequency.get(i)),
    peat: mean((i) => map.PeatCarbon.get(i)),
    temperature: mean((i) => environment(map, i).temperature),
    moisture: mean((i) => environment(map, i).moisture),
    wetness: mean((i) => environment(map, i).wetness),
    slope: mean((i) => map.Slope.get(i)),
    elevation: mean((i) => MapScale.metres(map.Elevation.get(i) - map.EffectiveSeaLevel, "native")),
    systems,
  } satisfies BiomeSummary;
}
