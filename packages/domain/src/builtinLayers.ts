import { profiles, type Layer } from "./model";

type Vocabulary = [string, string, string, Layer["representation"], string, string | null];
const vocabulary: Vocabulary[] = [
  ["elevation", "Elevation", "physical", "field", "#aaa183", "physical"],
  ["geology", "Geology and landforms", "physical", "field", "#998477", "physical"],
  ["ecology", "Biomes and life", "physical", "field", "#588860", "physical"],
  ["faults", "Fault traces", "physical", "vector", "#998477", "physical"],
  ["climate", "Climate", "water", "field", "#80a89b", "physical"],
  ["rivers", "Rivers", "water", "network", "#71c4de", "physical"],
  ["lakes", "Lakes", "water", "vector", "#67aabe", "physical"],
  ["magic", "Magical influences", "magic", "field", "#c199ee", "magic"],
  ["roads", "Roads and routes", "transport", "network", "#d9b779", "built"],
  ["settlements", "Settlements", "built", "vector", "#f2dab0", "built"],
  ["structures", "Structures and spaces", "built", "vector", "#d7b98f", "built"],
  ["sovereignty", "Sovereignty", "political", "vector", "#d49f79", "political"],
  ["administration", "Administration", "political", "vector", "#b9a46d", "political"],
  ["claims", "Territorial claims", "political", "vector", "#d8b36c", "political"],
  ["control", "Effective control", "political", "vector", "#ac7f97", "political"],
  ["cultures", "Cultural prevalence", "cultural", "field", "#87b7a0", "cultural"],
  ["languages", "Languages", "cultural", "field", "#9aa7d4", "cultural"],
  ["religions", "Religions and traditions", "cultural", "field", "#bc9bc7", "cultural"],
  ["pois", "Places of interest", "custom", "vector", "#f0cc7c", null],
];
const fieldFacts: Record<string, string[]> = {
  elevation: ["elevation", "relief"],
  geology: ["geology", "hardness", "fracture", "lithology", "uplift"],
  ecology: [
    "ecology",
    "biome",
    "treeCover",
    "grassCover",
    "wetlandCover",
    "productivity",
    "herbivores",
    "predators",
    "aquaticFauna",
  ],
  climate: ["climate", "temperature", "precipitation", "moisture", "windEast", "windNorth"],
  rivers: ["rivers", "flow"],
};
export function builtinLayers(): Layer[] {
  return vocabulary.map(([id, name, family, representation, color, generator]) => ({
    id,
    name,
    family,
    representation,
    color,
    generator,
    profiles: [...profiles],
    schema: {},
    representations: [...new Set([representation, "vector"])] as Layer["representations"],
    facts: fieldFacts[id] ?? [id],
  }));
}
export function layerSupports(
  layer: Layer,
  representation: "field" | "vector" | "network"
): boolean {
  return (layer.representations ?? [layer.representation]).includes(representation);
}
