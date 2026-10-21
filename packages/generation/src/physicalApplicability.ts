import type { FeatureApplicability, EpochControl, EpochValueKey } from "./generationPresentation";

const strength = (key: EpochValueKey, label: string): EpochControl => ({
  key,
  label,
  unit: "multiplier",
  min: 0,
  max: 1,
});
/** Actual consumers and editable epoch bindings, independent of UI page layout. */
export const physicalApplicability: Record<string, FeatureApplicability> = {
  "physical.foundation": {
    settingConsumers: {
      continents: ["canonry.tectonic-provinces"],
      provinces: ["canonry.tectonic-provinces"],
      landFraction: ["canonry.tectonic-provinces"],
    },
  },
  "physical.tectonic-history": {
    settingConsumers: { plateDrift: ["canonry.plate-advection"] },
    epochControls: [strength("tectonics", "Epoch tectonic activity")],
  },
  "physical.mountains": { epochControls: [strength("tectonics", "Epoch tectonic activity")] },
  "physical.volcanism": {
    settingConsumers: { volcanism: ["canonry.volcanic-construction"] },
    epochControls: [
      { key: "volcanism", label: "Epoch volcanic activity", unit: "multiplier", min: 0 },
    ],
  },
  "physical.impacts": {
    settingConsumers: {
      impacts: ["canonry.impact-cratering"],
      impactSize: ["canonry.impact-cratering"],
    },
    epochControls: [{ key: "impacts", label: "Epoch impact activity", unit: "multiplier", min: 0 }],
  },
  "physical.fractures": { epochControls: [strength("tectonics", "Epoch tectonic activity")] },
  "ocean.geography": {
    epochControls: [{ key: "seaLevel", label: "Epoch sea level offset", unit: "m" }],
  },
  "physical.coastal-evolution": {
    settingConsumers: { coastalErosion: ["canonry.coastal-erosion-and-deposition"] },
    epochControls: [strength("coasts", "Epoch coastal activity")],
  },
  "physical.climate": {
    settingConsumers: {
      temperature: ["canonry.temperature"],
      rainfall: ["canonry.precipitation"],
      seaLevel: ["canonry.ocean-connectivity"],
    },
    initialOnlySettings: ["seaLevel"],
    epochControls: [
      { key: "temperature", label: "Epoch temperature shift", unit: "°C" },
      { key: "rainfall", label: "Epoch rainfall", unit: "multiplier", min: 0, max: 5 },
    ],
  },
  "physical.river-incision": {
    settingConsumers: { erosion: ["canonry.ancestral-fluvial-erosion"] },
    epochControls: [strength("hydrology", "Epoch hydrological activity")],
  },
  "physical.land-ice": {
    epochControls: [
      strength("ice", "Epoch glacial activity"),
      strength("hydrology", "Epoch hydrological activity"),
    ],
  },
  "physical.glacial-sculpting": {
    settingConsumers: { glaciers: ["canonry.glacial-erosion", "canonry.glacial-deposition"] },
    epochControls: [strength("ice", "Epoch glacial activity")],
  },
};
