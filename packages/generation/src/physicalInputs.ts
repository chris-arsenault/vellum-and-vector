import type { GenerationFeature, ResolvedFeatures } from "./features";
import { nativeContracts } from "./canonry/contracts";

/** Consumers accepting absent contributions still require an explicit initializer. */
export const acceptedEmptyByConsumer: Record<string, string[]> = {
  "fracture-network": ["Impacts"],
  geothermal: ["VolcanicConstruction"],
  "ocean-currents": ["Geothermal"],
  "warmth-sources": ["Geothermal", "OceanCurrents"],
  temperature: ["Geothermal", "Warmth", "OceanCurrents"],
  precipitation: ["OceanCurrents"],
  "land-ice-mass-balance": ["Geothermal"],
  "glacial-meltwater": ["Geothermal"],
  "glacial-landforms": ["GlacialEvolution"],
  "sea-ice": ["LandIce", "OceanCurrents"],
  "landform-classification": ["GlacialRelief", "Impacts", "VolcanicConstruction"],
  "external-coastal-forcing": ["OceanCurrents", "SedimentTransport"],
  "coastal-erosion-and-deposition": ["OceanCurrents", "SedimentTransport"],
  "river-delta-formation": ["OceanCurrents", "SedimentTransport"],
  "physical-epoch-history": [
    "Geothermal",
    "SedimentTransport",
    "GlacialEvolution",
    "CoastalEvolution",
    "VolcanicConstruction",
  ],
  "physical-structural-validation": [
    "LandIce",
    "IceFlow",
    "SeaIce",
    "Landforms",
    "SedimentTransport",
    "GlacialEvolution",
    "CoastalEvolution",
    "RiverGeometry",
    "Floodplains",
    "Deltas",
    "Impacts",
    "VolcanicConstruction",
  ],
};

export function physicalInputContract(
  name: string,
  resolved: ResolvedFeatures,
  definitions: GenerationFeature[],
  inheritedAbsences: string[] = []
) {
  const absent = new Set(inheritedAbsences);
  for (const feature of definitions)
    if (!resolved.selection[feature.id]?.enabled)
      for (const item of feature.absent ?? []) absent.add(item.product.slice("canonry:".length));
  const source = spatialInputContract(name);
  const accepted = acceptedEmptyByConsumer[name] ?? [];
  return {
    ...source,
    inputs: source.requires
      .filter((product) => absent.has(product) && accepted.includes(product))
      .map((product) => ({ product, acceptEmptyFrom: "atlas.absent-physical" })),
  };
}

function spatialInputContract(name: string) {
  const source = nativeContracts[name];
  // Ice consumes carried water surfaces, not the outlet graph reset by remeshing.
  const carriesLakeState = [
    "land-ice-mass-balance",
    "ice-flow",
    "glacial-erosion",
    "glacial-meltwater",
  ];
  const requires = source.requires.map((product) => {
    if (name === "geothermal" && product === "Fractures") return "FractureState";
    if (carriesLakeState.includes(name) && product === "Lakes") return "LakeState";
    return product;
  });
  if (name === "flow-routing") requires.push("LakeOutlets");
  const produces = [...source.produces];
  if (name === "lake-basins") produces.push("LakeState", "LakeOutlets");
  // Connectivity clears previous lake inventory before classifying the ocean.
  if (name === "ocean-connectivity") produces.push("LakeState");
  const invalidates = [...source.invalidates];
  if (invalidates.includes("Lakes")) invalidates.push("LakeOutlets");
  return {
    ...source,
    requires,
    produces,
    invalidates,
  };
}
