/** Atlas extensions use SI quantities, including kg of carbon per square metre. */
export declare const ecologyRatios: readonly [
  "TreeCover",
  "GrassCover",
  "WetlandCover",
  "FireActivity",
  "BroadleafCover",
  "ConiferCover",
  "BroadleafSaplings",
  "ConiferSaplings",
  "GrassSeed",
  "BroadleafSeed",
  "ConiferSeed",
  "WetlandSeed",
  "EcologicalDamage",
  "EcologicalToxicity",
  "Infiltration",
];
export declare const ecologyCarbon: readonly [
  "SoilCarbon",
  "PeatCarbon",
  "AquaticCarbon",
  "BuriedPlantCarbon",
  "BuriedAquaticCarbon",
  "CoalCarbon",
  "OilCarbon",
  "GasCarbon",
];
export declare const ecologyMemory: readonly [
  "EcologySediment",
  "EcologyVolcanic",
  "EcologyImpact",
  "EcologyErosion",
  "EcologyIce",
];
export declare const ecologyLiving: readonly [
  "Grazers",
  "Browsers",
  "SoilDepth",
  "SoilWater",
  "MineralNutrients",
  "CanopyAge",
  "MigrationFlux",
  "FloodFrequency",
  "Evapotranspiration",
];
export declare const ecologyScalars: readonly [
  "TreeCover",
  "GrassCover",
  "WetlandCover",
  "FireActivity",
  "BroadleafCover",
  "ConiferCover",
  "BroadleafSaplings",
  "ConiferSaplings",
  "GrassSeed",
  "BroadleafSeed",
  "ConiferSeed",
  "WetlandSeed",
  "EcologicalDamage",
  "EcologicalToxicity",
  "Infiltration",
  "SoilCarbon",
  "PeatCarbon",
  "AquaticCarbon",
  "BuriedPlantCarbon",
  "BuriedAquaticCarbon",
  "CoalCarbon",
  "OilCarbon",
  "GasCarbon",
  "EcologySediment",
  "EcologyVolcanic",
  "EcologyImpact",
  "EcologyErosion",
  "EcologyIce",
  "Grazers",
  "Browsers",
  "SoilDepth",
  "SoilWater",
  "MineralNutrients",
  "CanopyAge",
  "MigrationFlux",
  "FloodFrequency",
  "Evapotranspiration",
  "Productivity",
  "AquaticProductivity",
  "Herbivores",
  "Predators",
  "AquaticFauna",
  "OrganicBurialDepth",
  "OrganicMaturity",
  "EcologyStillness",
];
export declare const ecologyFields: readonly [
  {
    readonly name: "BiomeCodes";
    readonly unit: "category";
  },
  {
    readonly name: "TreeCover";
    readonly unit: "ratio";
  },
  {
    readonly name: "GrassCover";
    readonly unit: "ratio";
  },
  {
    readonly name: "WetlandCover";
    readonly unit: "ratio";
  },
  {
    readonly name: "FireActivity";
    readonly unit: "ratio";
  },
  {
    readonly name: "Productivity";
    readonly unit: "kg-carbon/square-metre/year";
  },
  {
    readonly name: "AquaticProductivity";
    readonly unit: "kg-carbon/square-metre/year";
  },
  {
    readonly name: "Herbivores";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "Predators";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "AquaticFauna";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "SoilCarbon";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "PeatCarbon";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "AquaticCarbon";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "BuriedPlantCarbon";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "BuriedAquaticCarbon";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "CoalCarbon";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "OilCarbon";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "GasCarbon";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "OrganicBurialDepth";
    readonly unit: "metre";
  },
  {
    readonly name: "OrganicMaturity";
    readonly unit: "million-year-equivalent";
  },
  {
    readonly name: "BroadleafCover";
    readonly unit: "ratio";
  },
  {
    readonly name: "ConiferCover";
    readonly unit: "ratio";
  },
  {
    readonly name: "BroadleafSaplings";
    readonly unit: "ratio";
  },
  {
    readonly name: "ConiferSaplings";
    readonly unit: "ratio";
  },
  {
    readonly name: "GrassSeed";
    readonly unit: "ratio";
  },
  {
    readonly name: "BroadleafSeed";
    readonly unit: "ratio";
  },
  {
    readonly name: "ConiferSeed";
    readonly unit: "ratio";
  },
  {
    readonly name: "WetlandSeed";
    readonly unit: "ratio";
  },
  {
    readonly name: "SoilDepth";
    readonly unit: "metre";
  },
  {
    readonly name: "SoilWater";
    readonly unit: "metre";
  },
  {
    readonly name: "MineralNutrients";
    readonly unit: "kg-nitrogen/square-metre";
  },
  {
    readonly name: "EcologicalDamage";
    readonly unit: "ratio";
  },
  {
    readonly name: "EcologicalToxicity";
    readonly unit: "ratio";
  },
  {
    readonly name: "Grazers";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "Browsers";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "MigrationFlux";
    readonly unit: "kg-carbon/square-metre";
  },
  {
    readonly name: "FloodFrequency";
    readonly unit: "per-year";
  },
  {
    readonly name: "CanopyAge";
    readonly unit: "year";
  },
  {
    readonly name: "Infiltration";
    readonly unit: "ratio";
  },
  {
    readonly name: "Evapotranspiration";
    readonly unit: "metre/year";
  },
];
