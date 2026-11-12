import { choice, type CartographicControl } from "./cartographicControls";
import type { FeatureSelection } from "./features";
import { continentalMotionCartography, terrainCartography } from "./terrainCartography";

const profile = (values: Record<string, number>) => ({ configuration: { profile: values } });
const frame = (southLatitude: number, northLatitude: number) => ({
  "physical.climate": {
    settings: { southLatitude, northLatitude, latitudeProjection: 1 },
  },
});
const land = (
  continents: number,
  provinces: number,
  separation: number,
  warp: number,
  clustering: number,
  majorGrowth: number,
  variation: number
): FeatureSelection => ({
  "physical.foundation": {
    settings: { continents, provinces },
    ...profile({
      ContinentalAssemblySeparationDepth: separation,
      ContinentalWarpStrength: warp,
      ContinentalAssemblyClustering: clustering,
      ContinentalMajorAssemblies: 2,
      ContinentalMajorGrowth: majorGrowth,
      ContinentalAssemblyGrowthVariation: variation,
    }),
  },
});
const shoreline = (
  detail: number,
  scale: number,
  warp: number,
  amplitude: number,
  coastalErosion: number,
  capture: number,
  reach: number
): FeatureSelection => ({
  "physical.coastal-construction": profile({
    CoastalDetailStrength: detail,
    CoastalDetailScale: scale,
    CoastalDetailWarp: warp,
    CoastalDetailPassiveAmplitude: 0.0000155 * amplitude,
    CoastalDetailConvergentAmplitude: 0.000022 * amplitude,
    CoastalDetailRiftedAmplitude: 0.0000185 * amplitude,
    CoastalDetailTransformAmplitude: 0.0000085 * amplitude,
  }),
  "physical.coastal-evolution": {
    settings: { coastalErosion },
    ...profile({ CoastalDepositionFraction: capture, CoastalDepositionReach: reach }),
  },
});
const landmarks = (volcanism: number, plumes: number, impacts: number): FeatureSelection => ({
  "physical.volcanism": { settings: { volcanism }, ...profile({ MantlePlumeCount: plumes }) },
  "physical.impacts": {
    settings: { impacts, impactSize: 1 },
    ...profile({ ImpactPrimordialShare: 1000 }),
  },
});

export const physicalCartography: Record<string, CartographicControl | CartographicControl[]> = {
  "physical.foundation": [
    {
      id: "land-and-sea",
      label: "Continental organization",
      section: "land",
      initialOnly: true,
      defaultChoice: "broken",
      explanation:
        "Choose coherent continental interiors or dispersed crust assemblies. Ocean coverage is independent; motion and the water budget determine which landmasses remain separate.",
      choices: [
        choice("broad", "Broad continents", land(3, 42, 0.2, 0.025, 1, 3, 0.5)),
        choice("broken", "Broken continents", land(5, 56, 0.38, 0.045, 0.7, 1.5, 0.8)),
        choice("islands", "Island world", land(10, 70, 0.5, 0.065, 0, 1, 0.8)),
      ],
    },
    {
      id: "ocean-coverage",
      label: "Ocean coverage",
      section: "land",
      initialOnly: true,
      defaultChoice: "wide",
      explanation:
        "Set the initial exposed land share without changing the amount or organization of continental crust. Later history changes the shores.",
      choices: [
        choice("oceanic", "Ocean-dominated", {
          "physical.foundation": { settings: { landFraction: 0.25 } },
        }),
        choice("wide", "Wide oceans", {
          "physical.foundation": { settings: { landFraction: 0.38 } },
        }),
        choice("land", "Land-dominated", {
          "physical.foundation": { settings: { landFraction: 0.6 } },
        }),
      ],
    },
  ],
  "physical.mountains": terrainCartography,
  "physical.tectonic-history": continentalMotionCartography,
  "physical.coastal-construction": {
    id: "shoreline",
    label: "Shoreline",
    section: "land",
    initialOnly: true,
    defaultChoice: "inlets",
    explanation:
      "Broad reworked outlines, intricate inlets, or deposited river-mouth lowlands. Sediment supply and coastal exposure still matter.",
    choices: [
      choice("smooth", "Smooth sweeps", shoreline(450, 0.025, 0.0025, 0.4, 1.2, 700, 0.00625)),
      choice(
        "inlets",
        "Inlets and headlands",
        shoreline(1500, 0.01125, 0.00875, 1.3, 0.5, 500, 0.00375)
      ),
      choice("flats", "River-mouth flats", shoreline(350, 0.025, 0.002, 0.35, 0.35, 850, 0.00875)),
    ],
  },
  "physical.climate": [
    {
      id: "climate-coverage",
      label: "Climate coverage",
      section: "environment",
      initialOnly: true,
      defaultChoice: "hemispheres",
      explanation:
        "The latitude zones represented by this map, independent of its dimensions and map boundary.",
      choices: [
        choice("northern", "Northern lands", frame(10, 70)),
        choice("hemispheres", "Two hemispheres", frame(-70, 70)),
        choice("globe", "Pole to pole", frame(-90, 90)),
      ],
    },
    {
      id: "warmth",
      label: "Warmth",
      section: "environment",
      initialOnly: true,
      defaultChoice: "earthlike",
      explanation:
        "Shift snowlines and growing conditions. Latitude, altitude, sea transport and magical heat determine local temperatures.",
      choices: [
        choice("cooler", "Cooler", { "physical.climate": { settings: { temperature: 5 } } }),
        choice("earthlike", "Earth-like", {
          "physical.climate": { settings: { temperature: 15 } },
        }),
        choice("warmer", "Warmer", { "physical.climate": { settings: { temperature: 23 } } }),
      ],
    },
  ],
  "physical.volcanism": {
    id: "landmarks",
    label: "Distinctive landmarks",
    section: "land",
    initialOnly: true,
    defaultChoice: "scattered",
    explanation:
      "The prominence of volcanic districts and crater landforms. Footprints scale with the map, and history determines what survives.",
    choices: [
      choice("rare", "Rare", landmarks(0.25, 1, 1)),
      choice("scattered", "Scattered", landmarks(0.7, 2, 3)),
      choice("prominent", "Prominent", landmarks(1.3, 4, 7)),
    ].map((item) => ({
      ...item,
      resolve: (selection: FeatureSelection) => {
        const epochs = selection["physical.lifecycle"].configuration!.epochs as unknown as Record<
          string,
          number | string
        >[];
        return {
          ...item.features,
          "physical.lifecycle": {
            configuration: {
              epochs: epochs.map((epoch, i) => ({
                ...epoch,
                impacts: 0,
                volcanism: [1, 0.4, 0.1][
                  Math.min(2, Math.round((i * 2) / Math.max(1, epochs.length - 1)))
                ],
              })),
            },
          },
        };
      },
    })),
  },
};
