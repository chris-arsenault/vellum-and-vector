import { choice, type CartographicControl } from "./cartographicControls";
import type { FeatureSelection } from "./features";

const profile = (values: Record<string, number>) => ({ configuration: { profile: values } });
function terrain(index: number): FeatureSelection {
  const glaciated = index === 3;
  return {
    "physical.foundation": profile({
      InteriorReliefStrength: [0.06, 0.14, 0.25, 0.16][index],
      ElevationVariationStrength: [0.06, 0.12, 0.16, 0.12][index],
    }),
    "physical.tectonic-history": {
      settings: { plateDrift: [0.15, 0.6, 1.2, 0.7][index] },
      ...profile({
        // length-unit: fraction — resolved by the owning map's profile.
        EpochTectonicElevationStep: [0.000015, 0.00004, 0.00008, 0.00004][index],
      }),
    },
    "physical.river-incision": {
      settings: { erosion: [0.25, 0.7, 1.5, 0.7][index] },
      ...profile({ FluvialEquilibriumGradient: [0.0012, 0.0008, 0.0004, 0.0008][index] }),
    },
    "material.fluvial-transport": profile({
      SedimentTransportFraction: [850, 760, 650, 760][index],
      // length-unit: fraction — compound length coefficient resolved with the profile.
      SedimentCarry: [0.015, 0.025, 0.04, 0.025][index],
    }),
    "physical.glacial-sculpting": {
      settings: { glaciers: [0.3, 0.5, 0.7, 1.2][index] },
      ...profile({
        // length-unit: fraction — inverse-length coefficient resolved with the profile.
        IceAltitudeBalance: [0, 0, 0, 1_000_000][index],
      }),
    },
    "physical.lifecycle": {
      configuration: {
        history: {
          tectonics: [
            [0.15, 0.1, 0.03],
            [0.6, 0.3, 0.1],
            [1, 0.65, 0.25],
            [0.7, 0.3, 0.1],
          ][index],
        },
      },
    },
    "ecology.living": { configuration: { glaciated } },
  };
}
export const terrainCartography: CartographicControl = {
  id: "terrain",
  label: "Terrain",
  section: "land",
  initialOnly: true,
  // A world has both plains and ranges; a planet of hills is a deliberate choice, not the default.
  defaultChoice: "ranges",
  explanation:
    "Coordinate relief, valleys and deposited surfaces, including inherited glacial landforms where the past climate supported ice.",
  choices: ["Wide plains", "Rolling hills", "Mountain ranges", "Glacier-carved"].map(
    (label, index) => choice(["plains", "hills", "ranges", "glacial"][index], label, terrain(index))
  ),
};
