import { choice, type CartographicControl } from "./cartographicControls";
import type { FeatureSelection } from "./features";
import { terrainCartography } from "./terrainCartography";

const profile = (values: Record<string, number>) => ({ configuration: { profile: values } });
const frame = (southLatitude: number, northLatitude: number, wrapLongitude: number) => ({
  "physical.climate": {
    settings: { southLatitude, northLatitude, latitudeProjection: 1, wrapLongitude },
  },
});
const land = (
  continents: number,
  provinces: number,
  landFraction: number,
  seaLevel: number,
  separation: number,
  warp: number
): FeatureSelection => ({
  "physical.foundation": {
    settings: { continents, provinces, landFraction },
    ...profile({ ContinentalAssemblySeparationDepth: separation, ContinentalWarpStrength: warp }),
  },
  "physical.climate": { settings: { seaLevel } },
});
const shoreline = (
  detail: number,
  scale: number,
  warp: number,
  amplitude: number,
  coastalErosion: number,
  capture: number,
  reach: number,
  delta: number
): FeatureSelection => ({
  "physical.coastal-construction": profile({
    CoastalDetailStrength: detail,
    CoastalDetailScale: scale,
    CoastalDetailWarp: warp,
    CoastalDetailPassiveAmplitude: 62 * amplitude,
    CoastalDetailConvergentAmplitude: 88 * amplitude,
    CoastalDetailRiftedAmplitude: 74 * amplitude,
    CoastalDetailTransformAmplitude: 34 * amplitude,
  }),
  "physical.coastal-evolution": {
    settings: { coastalErosion },
    ...profile({ CoastalDepositionFraction: capture, CoastalDepositionReach: reach }),
  },
  "physical.deltas": profile({ DeltaMaximumRadius: delta }),
});
const landmarks = (volcanism: number, plumes: number, impacts: number): FeatureSelection => ({
  "physical.volcanism": { settings: { volcanism }, ...profile({ MantlePlumeCount: plumes }) },
  "physical.impacts": {
    settings: { impacts, impactSize: 1 },
    ...profile({ ImpactPrimordialShare: 1000 }),
  },
});

export const physicalCartography: Record<string, CartographicControl | CartographicControl[]> = {
  "physical.foundation": {
    id: "land-and-sea",
    label: "Land and sea",
    section: "land",
    initialOnly: true,
    defaultChoice: "broken",
    explanation:
      "Large interiors, broken continental shores or a fragmented maritime world. Final coastlines follow the terrain and water.",
    choices: [
      choice("broad", "Broad continents", land(2, 24, 0.68, -60, 0.2, 100_000)),
      choice("broken", "Broken continents", land(4, 42, 0.48, 0, 0.38, 180_000)),
      choice("islands", "Island world", land(10, 70, 0.28, 60, 0.5, 260_000)),
    ],
  },
  "physical.mountains": terrainCartography,
  "physical.coastal-construction": {
    id: "shoreline",
    label: "Shoreline",
    section: "land",
    initialOnly: true,
    defaultChoice: "smooth",
    explanation:
      "Broad reworked outlines, intricate inlets, or deposited river-mouth lowlands. Sediment supply and coastal exposure still matter.",
    choices: [
      choice(
        "smooth",
        "Smooth sweeps",
        shoreline(450, 100_000, 10_000, 0.4, 1.2, 700, 25_000, 20_000)
      ),
      choice(
        "inlets",
        "Inlets and headlands",
        shoreline(1500, 45_000, 35_000, 1.3, 0.5, 500, 15_000, 30_000)
      ),
      choice(
        "flats",
        "River-mouth flats",
        shoreline(350, 100_000, 8_000, 0.35, 0.35, 850, 35_000, 45_000)
      ),
    ],
  },
  "physical.climate": [
    {
      id: "climate-coverage",
      label: "Climate coverage",
      section: "environment",
      initialOnly: true,
      defaultChoice: "northern",
      explanation:
        "The latitude zones represented by this map, independent of its dimensions. Pole-to-pole climate wraps air and ocean east–west.",
      choices: [
        choice("northern", "Northern lands", frame(10, 70, 0)),
        choice("hemispheres", "Two hemispheres", frame(-70, 70, 0)),
        choice("globe", "Pole to pole", frame(-90, 90, 1)),
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
      "The prominence of volcanic districts and crater landforms within the background landscape. All choices retain both kinds of landform.",
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
