import { z } from "zod";

/** Ecological forcing belongs to the same physical epochs as climate and ice. */
export const ecologyEpochSchema = z.object({
  rainfall: z.number().finite().min(0).max(5).default(1),
  seasonality: z.number().finite().min(0).max(1).default(0.3),
  productivity: z.number().finite().min(0).max(5).default(1),
  fire: z.number().finite().min(0).max(5).default(1),
  migration: z.number().finite().min(0).max(5).default(1),
  recovery: z.number().finite().min(0).max(5).default(1),
});
export type EcologyEpoch = z.infer<typeof ecologyEpochSchema>;
export const defaultEcologyEpoch = ecologyEpochSchema.parse({});

/** Cover classes are independent of the relief/landform classification. */
export const biomes = [
  { name: "Unclassified", color: "#d1c8ae" },
  { name: "Ocean", color: "#397d99" },
  { name: "Freshwater", color: "#498b99" },
  { name: "Ice", color: "#e2ede8" },
  { name: "Barren", color: "#b5a58c" },
  { name: "Desert", color: "#ddc78d" },
  { name: "Tundra", color: "#a4b19a" },
  { name: "Grassland", color: "#afbd74" },
  { name: "Savanna", color: "#c0b76a" },
  { name: "Woodland", color: "#7eaa66" },
  { name: "Temperate forest", color: "#4f8d55" },
  { name: "Boreal forest", color: "#527c68" },
  { name: "Rainforest", color: "#28674c" },
  { name: "Marsh", color: "#83a794" },
  { name: "Swamp", color: "#547c69" },
  { name: "Altered woodland", color: "#76618e" },
  { name: "Altered wetland", color: "#77768f" },
] as const;
export const biomeCode = (name: (typeof biomes)[number]["name"]) =>
  biomes.findIndex((biome) => biome.name === name);
/** Named biome regions, by the feature kind of the rule that outlines them. */
export const biomeFamilies = [
  { kind: "forest", name: "Forest", color: "#4f8d55" },
  { kind: "grassland", name: "Grassland", color: "#afbd74" },
  { kind: "wetland", name: "Wetland", color: "#83a794" },
  { kind: "barren", name: "Barren land", color: "#ddc78d" },
  { kind: "ember", name: "Ember grassland", color: "#c9774a" },
  { kind: "thaw", name: "Thaw ground", color: "#9fc7b0" },
  { kind: "altered", name: "Altered land", color: "#76618e" },
] as const;

export const ecologyLabels: Record<string, string> = {
  biome: "Biomes",
  treeCover: "Tree cover",
  grassCover: "Grass and shrub cover",
  wetlandCover: "Wetland plant cover",
  productivity: "Plant production",
  aquaticProductivity: "Aquatic production",
  herbivores: "Herbivore biomass",
  predators: "Predator biomass",
  aquaticFauna: "Aquatic consumer biomass",
  soilCarbon: "Soil organic carbon",
  peatCarbon: "Peat carbon",
  aquaticCarbon: "Aquatic organic sediment",
  buriedPlantCarbon: "Buried terrestrial source carbon",
  buriedAquaticCarbon: "Buried aquatic source carbon",
  coalCarbon: "Coal carbon",
  oilCarbon: "Oil source potential",
  gasCarbon: "Gas source potential",
  organicBurialDepth: "Organic burial depth",
  organicMaturity: "Organic thermal exposure",
  fireActivity: "Fire disturbance",
  broadleafCover: "Broadleaf canopy",
  coniferCover: "Conifer canopy",
  alteredCover: "Magically altered canopy",
  broadleafSaplings: "Young broadleaf trees",
  coniferSaplings: "Young conifers",
  alteredSaplings: "Young altered trees",
  grassSeed: "Grass and shrub seed bank",
  broadleafSeed: "Broadleaf seed bank",
  coniferSeed: "Conifer seed bank",
  wetlandSeed: "Wetland seed bank",
  alteredSeed: "Altered seed bank",
  soilDepth: "Ecological soil depth",
  soilWater: "Plant-available soil water",
  mineralNutrients: "Available soil nitrogen",
  ecologicalDamage: "Ecological disturbance legacy",
  ecologicalAlteration: "Persistent magical alteration",
  coldAdaptation: "Inherited magical cold tolerance",
  droughtAdaptation: "Inherited magical drought tolerance",
  ecologicalToxicity: "Habitat toxicity",
  grazers: "Grazing animal biomass",
  browsers: "Browsing animal biomass",
  migrationFlux: "Animal migration",
  floodFrequency: "Flood frequency",
  canopyAge: "Mean canopy age",
  infiltration: "Infiltrated precipitation fraction",
  evapotranspiration: "Ecological evapotranspiration",
};
