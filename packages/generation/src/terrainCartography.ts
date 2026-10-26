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
      ...profile({ EpochTectonicElevationStep: [60, 160, 320, 160][index] }),
    },
    // The root budget carries the crest (0.7 m of height per metre of root), so rank sets
    // height; the per-pass bedrock relief adds summit texture. Plateaus are the root spread
    // behind the belt: none on plains, wide under Mountain ranges.
    "physical.mountains": profile({
      InitialOrogenicConstructionStep: [400, 1600, 3600, 2200][index],
      EpochOrogenicConstructionStep: [150, 500, 1400, 600][index],
      OrogenicProminenceMinimum: [350, 350, 800, 500][index],
      OrogenicProminenceMaximum: [1000, 1000, 2200, 1400][index],
      OrogenicRootBudgetMinimum: [400, 800, 1800, 1000][index],
      OrogenicRootBudgetMaximum: [1200, 2800, 6400, 3400][index],
      MaximumOrogenicSurfaceReliefPerPass: [300, 700, 1200, 900][index],
      OrogenicPlateauWidth: [0, 120_000, 360_000, 200_000][index],
      OrogenicPlateauShare: [0, 0.35, 0.7, 0.5][index],
    }),
    "physical.river-incision": {
      settings: { erosion: [0.25, 0.7, 1.5, 0.7][index] },
      ...profile({ FluvialEquilibriumGradient: [0.0012, 0.0008, 0.0004, 0.0008][index] }),
    },
    "material.fluvial-transport": profile({
      SedimentTransportFraction: [850, 760, 650, 760][index],
      MaximumSedimentDepositionPerPass: [30, 18, 12, 20][index],
    }),
    "physical.floodplains": profile({
      FloodplainMaximumWidth: [25_000, 15_000, 8_000, 15_000][index],
    }),
    "physical.glacial-sculpting": {
      settings: { glaciers: [0.3, 0.5, 0.7, 1.2][index] },
      ...profile({ IceAltitudeBalance: [0, 0, 0, 0.25][index] }),
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
