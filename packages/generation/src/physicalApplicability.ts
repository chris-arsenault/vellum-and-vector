import type { FeatureApplicability, EpochControl, EpochValueKey } from "./generationPresentation";
import { latitudeFrameSettings } from "./atlasParameters";

/** Settings owned by `physical.climate`: baseline climate plus the world frame. */
export const climateSettings = [
  "temperature",
  "rainfall",
  "seaLevel",
  ...latitudeFrameSettings,
] as const;

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
      continents: ["atlas.tectonic-provinces"],
      oceanicPlates: ["atlas.tectonic-provinces"],
      provinces: ["atlas.tectonic-provinces"],
      landFraction: ["atlas.tectonic-provinces"],
      mapBoundary: ["atlas.initialize", "atlas.tectonic-provinces"],
    },
    initialOnlySettings: ["mapBoundary"],
  },
  "physical.tectonic-history": {
    settingConsumers: { plateDrift: ["atlas.plate-advection"] },
    epochControls: [
      strength("tectonics", "Epoch tectonic activity"),
      { key: "tectonicDurationMyr", label: "Geological interval", unit: "Myr", min: 0 },
    ],
  },
  "physical.mountains": { epochControls: [strength("tectonics", "Epoch tectonic activity")] },
  "physical.volcanism": {
    settingConsumers: { volcanism: ["atlas.volcanic-construction"] },
    epochControls: [
      { key: "volcanism", label: "Epoch volcanic activity", unit: "multiplier", min: 0 },
    ],
  },
  "physical.impacts": {
    settingConsumers: {
      impacts: ["atlas.impact-cratering"],
      impactSize: ["atlas.impact-cratering"],
    },
    epochControls: [{ key: "impacts", label: "Epoch impact activity", unit: "multiplier", min: 0 }],
  },
  "physical.landmarks": {
    settingConsumers: {
      landscapeLandmarks: ["landmark.emplace"],
      magicLandmarks: ["landmark.emplace"],
    },
  },
  "physical.fractures": { epochControls: [strength("tectonics", "Epoch tectonic activity")] },
  "ocean.geography": {
    epochControls: [{ key: "seaLevel", label: "Epoch sea level offset", unit: "m" }],
  },
  "physical.coastal-evolution": {
    settingConsumers: { coastalErosion: ["atlas.coastal-erosion-and-deposition"] },
    epochControls: [strength("coasts", "Epoch coastal activity")],
  },
  "physical.climate": {
    settingConsumers: {
      temperature: ["atlas.temperature"],
      rainfall: ["atlas.precipitation"],
      seaLevel: ["atlas.ocean-connectivity"],
      southLatitude: ["atlas.temperature", "atlas.atmospheric-flow"],
      northLatitude: ["atlas.temperature", "atlas.atmospheric-flow"],
      latitudeProjection: ["atlas.temperature", "atlas.atmospheric-flow"],
    },
    // Latitude belongs to the world frame; regions read their parent's frame.
    initialOnlySettings: ["seaLevel", ...latitudeFrameSettings],
    epochControls: [
      { key: "temperature", label: "Epoch temperature shift", unit: "°C" },
      { key: "rainfall", label: "Epoch rainfall", unit: "multiplier", min: 0, max: 5 },
    ],
  },
  "physical.river-incision": {
    settingConsumers: { erosion: ["atlas.ancestral-fluvial-erosion"] },
    epochControls: [strength("hydrology", "Epoch hydrological activity")],
  },
  "physical.land-ice": {
    epochControls: [
      strength("ice", "Epoch glacial activity"),
      strength("hydrology", "Epoch hydrological activity"),
    ],
  },
  "physical.glacial-sculpting": {
    settingConsumers: { glaciers: ["atlas.glacial-erosion", "atlas.glacial-deposition"] },
    epochControls: [strength("ice", "Epoch glacial activity")],
  },
};
