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
  // Living landscapes a magic system makes through its own mechanism (fifth pass):
  // Fire's quickening, Aurora's stillness and the fog of a Pressure upwelling coast.
  { name: "Ember grove", color: "#6f9f3c" },
  { name: "Thaw meadow", color: "#a9c86f" },
  { name: "Rime forest", color: "#7d98a4" },
  { name: "Glow-lichen barrens", color: "#b9d4d6" },
  { name: "Fog heath", color: "#9db3a1" },
  { name: "Moss forest", color: "#4e8470" },
  // Greenwood's verdure: the forest past its climate, the braided fen, the meadow at a spring.
  { name: "Deepwood", color: "#2f6b3a" },
  { name: "Wending fen", color: "#6e9a7c" },
  { name: "Well meadow", color: "#9cc26a" },
  // Salt's residue: the memorial heath on a killing ground, the pan, the fused flat.
  { name: "Barrow heath", color: "#9a8f7a" },
  { name: "Salt pan", color: "#e8e2d2" },
  { name: "Glass flat", color: "#cfd9e3" },
] as const;
export const biomeCode = (name: (typeof biomes)[number]["name"]) =>
  biomes.findIndex((biome) => biome.name === name);
/** Named biome regions, by the feature kind of the rule that outlines them. */
export const biomeFamilies = [
  { kind: "forest", name: "Forest", color: "#4f8d55" },
  { kind: "grassland", name: "Grassland", color: "#afbd74" },
  { kind: "wetland", name: "Wetland", color: "#83a794" },
  { kind: "barren", name: "Barren land", color: "#ddc78d" },
  { kind: "ember", name: "Ember grove", color: "#6f9f3c" },
  { kind: "thaw", name: "Thaw meadow", color: "#a9c86f" },
  { kind: "rime", name: "Rime forest", color: "#7d98a4" },
  { kind: "glow", name: "Glow-lichen barrens", color: "#b9d4d6" },
  { kind: "fog", name: "Fog coast", color: "#9db3a1" },
  { kind: "deepwood", name: "Deepwood", color: "#2f6b3a" },
  { kind: "wending", name: "Wending fen", color: "#6e9a7c" },
  { kind: "well", name: "Well meadow", color: "#9cc26a" },
  { kind: "barrow", name: "Barrow heath", color: "#9a8f7a" },
  { kind: "pan", name: "Salt pan", color: "#e8e2d2" },
  { kind: "flat", name: "Glass flat", color: "#cfd9e3" },
] as const;

export const ecologyLabels: Record<string, string> = {
  BiomeCodes: "Biomes",
  TreeCover: "Tree cover",
  GrassCover: "Grass and shrub cover",
  WetlandCover: "Wetland plant cover",
  Productivity: "Plant production",
  AquaticProductivity: "Aquatic production",
  Herbivores: "Herbivore biomass",
  Predators: "Predator biomass",
  AquaticFauna: "Aquatic consumer biomass",
  SoilCarbon: "Soil organic carbon",
  PeatCarbon: "Peat carbon",
  AquaticCarbon: "Aquatic organic sediment",
  BuriedPlantCarbon: "Buried terrestrial source carbon",
  BuriedAquaticCarbon: "Buried aquatic source carbon",
  CoalCarbon: "Coal carbon",
  OilCarbon: "Oil source potential",
  GasCarbon: "Gas source potential",
  OrganicBurialDepth: "Organic burial depth",
  OrganicMaturity: "Organic thermal exposure",
  FireActivity: "Fire disturbance",
  BroadleafCover: "Broadleaf canopy",
  ConiferCover: "Conifer canopy",
  BroadleafSaplings: "Young broadleaf trees",
  ConiferSaplings: "Young conifers",
  GrassSeed: "Grass and shrub seed bank",
  BroadleafSeed: "Broadleaf seed bank",
  ConiferSeed: "Conifer seed bank",
  WetlandSeed: "Wetland seed bank",
  SoilDepth: "Ecological soil depth",
  SoilWater: "Plant-available soil water",
  MineralNutrients: "Available soil nitrogen",
  EcologicalDamage: "Ecological disturbance legacy",
  EcologicalToxicity: "Habitat toxicity",
  Grazers: "Grazing animal biomass",
  Browsers: "Browsing animal biomass",
  MigrationFlux: "Animal migration",
  FloodFrequency: "Flood frequency",
  CanopyAge: "Mean canopy age",
  Infiltration: "Infiltrated precipitation fraction",
  Evapotranspiration: "Ecological evapotranspiration",
};
