import type {
  FeaturePresentation,
  GenerationSetupStage,
  EpochControl,
  EpochValueKey,
} from "./generationPresentation";

function describe(
  stage: GenerationSetupStage,
  family: string,
  order: number,
  summary: string,
  settingConsumers?: Record<string, readonly string[]>,
  epochControls?: EpochControl[]
): FeaturePresentation {
  return { stage, family, order, summary, settingConsumers, epochControls };
}
const strength = (key: EpochValueKey, label: string): EpochControl => ({
  key,
  label,
  unit: "multiplier",
  min: 0,
  max: 1,
});
/** Descriptive ownership beside the physical module; these entries never select operations. */
export const physicalPresentation: Record<string, FeaturePresentation> = {
  "physical.lifecycle": describe(
    "world",
    "Shared time",
    0,
    "One physical timeline supplies epoch names, order and duration to the selected systems; structural validation checks the resulting geography."
  ),
  "physical.foundation": describe(
    "land",
    "Continental construction",
    10,
    "Establish continental assemblies, tectonic provinces and the initial landscape. Existing regional foundations are inherited.",
    {
      continents: ["canonry.tectonic-provinces"],
      provinces: ["canonry.tectonic-provinces"],
      landFraction: ["canonry.tectonic-provinces"],
    }
  ),
  "physical.tectonic-history": describe(
    "land",
    "Continental construction",
    20,
    "Move the crust and evolve tectonic activity through the shared epochs.",
    { plateDrift: ["canonry.plate-advection"] },
    [strength("tectonics", "Epoch tectonic activity")]
  ),
  "physical.mountains": describe(
    "land",
    "Continental construction",
    30,
    "Build mountain relief from tectonic structure and retain its construction history.",
    undefined,
    [strength("tectonics", "Epoch tectonic activity")]
  ),
  "physical.volcanism": describe(
    "land",
    "Event geography",
    40,
    "Establish mantle roots and construct volcanic cones, aprons and calderas as one capability.",
    { volcanism: ["canonry.volcanic-construction"] },
    [{ key: "volcanism", label: "Epoch volcanic activity", unit: "multiplier", min: 0 }]
  ),
  "physical.impacts": describe(
    "land",
    "Event geography",
    50,
    "Add impact excavation, rims and ejecta using the configured history budget and crater scale.",
    {
      impacts: ["canonry.impact-cratering"],
      impactSize: ["canonry.impact-cratering"],
    },
    [{ key: "impacts", label: "Epoch impact activity", unit: "multiplier", min: 0 }]
  ),
  "physical.hillslopes": describe(
    "land",
    "Material response",
    60,
    "Redistribute material down slopes and reconcile slopes after river incision."
  ),
  "material.load-response": describe(
    "land",
    "Material response",
    70,
    "Respond to crust, sediment and ice loads through shared support and lithospheric flexure."
  ),
  "physical.coastal-construction": describe(
    "land",
    "Structure and relief",
    80,
    "Add initial coastal detail during continental construction; later coastal change is a separate choice."
  ),
  "physical.fractures": describe(
    "land",
    "Structure and relief",
    90,
    "Construct the fault network; impacts and volcanism can also contribute to shared fracture conductance.",
    undefined,
    [strength("tectonics", "Epoch tectonic activity")]
  ),
  "physical.geothermal": describe(
    "land",
    "Structure and relief",
    100,
    "Calculate geothermal geography from material structure, volcanic history and fracture conductance."
  ),
  "physical.landforms": describe(
    "land",
    "Structure and relief",
    110,
    "Classify resulting physical relief into geographic landforms."
  ),
  "ocean.geography": describe(
    "environment",
    "Ocean and shores",
    10,
    "Resolve connected ocean, distance from ocean, bathymetry, landmasses and shelf groups.",
    undefined,
    [{ key: "seaLevel", label: "Epoch sea level offset", unit: "m" }]
  ),
  "physical.ocean-circulation": describe(
    "environment",
    "Ocean and shores",
    20,
    "Calculate ocean currents and the heat they transport into the climate."
  ),
  "physical.continental-margins": describe(
    "environment",
    "Ocean and shores",
    30,
    "Evolve continental margins and redistribute marine deposits together."
  ),
  "physical.coastal-evolution": describe(
    "environment",
    "Ocean and shores",
    40,
    "Combine natural and external coastal forcing with coastal erosion and deposition.",
    {
      coastalErosion: ["canonry.coastal-erosion-and-deposition"],
    },
    [strength("coasts", "Epoch coastal activity")]
  ),
  "physical.climate": {
    ...describe(
      "environment",
      "Climate",
      50,
      "Calculate temperature, atmospheric flow, moisture and precipitation; epoch values modify the shared physical context.",
      {
        temperature: ["canonry.temperature"],
        rainfall: ["canonry.precipitation"],
        seaLevel: ["canonry.ocean-connectivity"],
      }
    ),
    initialOnlySettings: ["seaLevel"],
    epochControls: [
      { key: "temperature", label: "Epoch temperature shift", unit: "°C" },
      { key: "rainfall", label: "Epoch rainfall", unit: "multiplier", min: 0, max: 5 },
    ],
  },
  "water.routing": describe(
    "environment",
    "River systems",
    60,
    "Establish shared runoff, lakes, outlets and drainage routing for rivers, sediment and ice."
  ),
  "physical.river-networks": describe(
    "environment",
    "River systems",
    70,
    "Extract river channel geometry from the shared water network without requiring incision."
  ),
  "physical.river-incision": describe(
    "environment",
    "River systems",
    80,
    "Cut river valleys through material; network output remains an independent choice.",
    { erosion: ["canonry.ancestral-fluvial-erosion"] },
    [strength("hydrology", "Epoch hydrological activity")]
  ),
  "material.fluvial-transport": describe(
    "environment",
    "River systems",
    90,
    "Transport sediment through the shared river system and retain its deposition history."
  ),
  "physical.floodplains": describe(
    "environment",
    "River systems",
    100,
    "Extract floodplain geography from the resolved river channels."
  ),
  "physical.deltas": describe(
    "environment",
    "River systems",
    110,
    "Form deltas from rivers, floodplains, sediment transport and the coastal setting."
  ),
  "physical.land-ice": describe(
    "environment",
    "Ice",
    120,
    "Calculate ice mass balance, ice flow and meltwater; repeated model passes retain their existing causal order.",
    undefined,
    [
      strength("ice", "Epoch glacial activity"),
      strength("hydrology", "Epoch hydrological activity"),
    ]
  ),
  "physical.glacial-sculpting": describe(
    "environment",
    "Ice",
    130,
    "Combine glacial erosion, deposition and glacial relief into one sculpting capability.",
    { glaciers: ["canonry.glacial-erosion", "canonry.glacial-deposition"] },
    [strength("ice", "Epoch glacial activity")]
  ),
  "physical.sea-ice": describe(
    "environment",
    "Ice",
    140,
    "Classify sea ice from ocean and climate independently of land-ice sculpting."
  ),
};
