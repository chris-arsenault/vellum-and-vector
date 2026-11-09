import { choice, type CartographicControl } from "./cartographicControls";
import type { FeatureSelection } from "./features";

const profile = (values: Record<string, number>) => ({ configuration: { profile: values } });
function terrain(index: number): FeatureSelection {
  const glaciated = index === 3;
  return {
    "physical.foundation": profile({
      InteriorReliefStrength: [0.025, 0.07, 0.25, 0.1][index],
      ElevationVariationStrength: [0.02, 0.05, 0.16, 0.06][index],
    }),
    "physical.mountains": profile({
      // Initial shortening builds the inherited belts; later motion adds actual collisions.
      // length-unit: fraction
      OrogenicInitialShortening: [0.001, 0.025, 0.15, 0.025][index],
    }),
    "physical.river-incision": {
      settings: { erosion: [1, 1, 1.5, 1][index] },
      ...profile({ FluvialEquilibriumGradient: [0.0002, 0.0004, 0.0004, 0.0004][index] }),
    },
    "material.fluvial-transport": profile({
      SedimentTransportFraction: [600, 700, 650, 700][index],
      // length-unit: fraction — compound length coefficient resolved with the profile.
      SedimentCarry: [0.012, 0.02, 0.04, 0.02][index],
    }),
    "physical.glacial-sculpting": {
      settings: { glaciers: [0.3, 0.5, 0.7, 1.2][index] },
      ...profile({
        // length-unit: fraction — inverse-length coefficient resolved with the profile.
        IceAltitudeBalance: [0, 0, 0, 1_000_000][index],
      }),
    },
    "ecology.living": { configuration: { glaciated } },
  };
}
export const terrainCartography: CartographicControl = {
  id: "terrain",
  label: "Terrain",
  section: "land",
  initialOnly: true,
  defaultChoice: "balanced",
  explanation:
    "Choose inherited mountain relief and how erosion, deposition and glaciers rework it. Continental motion, shoreline detail and island organization have separate controls.",
  choices: ["Mostly plains", "Plains and ranges", "Mostly mountains", "Glacier-carved"].map(
    (label, index) =>
      choice(["plains", "balanced", "ranges", "glacial"][index], label, terrain(index))
  ),
};

export const continentalMotionCartography: CartographicControl = {
  id: "continental-motion",
  label: "Continental motion",
  section: "land",
  initialOnly: true,
  defaultChoice: "drifting",
  explanation:
    "Set how strongly plates move and rework continents through history. Motion changes coasts, opens or closes seas and builds new collision ranges independently of inherited terrain.",
  choices: ["Quiet plates", "Drifting continents", "Restless plates"].map((label, index) =>
    choice(["quiet", "drifting", "restless"][index], label, {
      "physical.tectonic-history": {
        settings: { plateDrift: [0.05, 0.45, 1.2][index] },
      },
      "physical.lifecycle": {
        configuration: {
          history: {
            tectonics: [
              [0.12, 0.04, 0.01],
              [0.6, 0.25, 0.08],
              [1, 0.65, 0.25],
            ][index],
          },
        },
      },
    })
  ),
};
