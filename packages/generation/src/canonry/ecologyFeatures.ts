import type { GenerationState } from "../process";
import { biomeRules, type BiomeSummary } from "./ecologyBiomes";
import type { RegionMembers } from "./regionMembers";
import { extractWorldEcologicalFeatures } from "./worldEcologyFeatures";

type Term = (i: number) => number;
const families: Record<string, string> = {
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
function summarize(
  state: GenerationState,
  members: RegionMembers,
  biome: ReturnType<typeof biomeRules>
) {
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
    temperature: mean((i) => biome.temperature.get(i)),
    moisture: mean((i) => biome.moisture.get(i)),
    wetness: mean((i) => biome.wetness.get(i)),
    slope: mean((i) => map.Slope.get(i)),
    elevation: mean((i) => (map.Elevation.get(i) - map.BaseSeaLevel) / 1024),
    systems,
  } satisfies BiomeSummary;
}
/**
 * Named landscapes are coherent regions of one biome family, significant at the map's scale
 * (ADR 0005): the same rule on every map, its thresholds scaled to the map's cell span.
 * Continuous cover and the biome classes remain the ecological representation everywhere.
 */
export function extractEcologicalFeatures(state: GenerationState) {
  extractWorldEcologicalFeatures(state, families, summarize);
}
