import type { MagicSystem, ParameterValues } from "@atlas/domain";
import { requireThat } from "@atlas/domain";
import type { CartographicControl } from "./cartographicControls";
import type { FeatureSelection } from "./features";

type SystemPatch = {
  parameters?: Partial<MagicSystem["parameters"]>;
  effects?: Partial<MagicSystem["effects"]>;
};

function control(
  system: string,
  id: string,
  label: string,
  explanation: string,
  alternatives: readonly string[],
  patches: readonly SystemPatch[]
): CartographicControl {
  return {
    id: `${system}.${id}`,
    label,
    explanation,
    section: "environment",
    system,
    initialOnly: true,
    fields: [
      ...new Set(
        patches.flatMap((patch) =>
          Object.entries(patch).flatMap(([group, values]) =>
            Object.keys(values).map((key) => `magic.${system}.${group}.${key}`)
          )
        )
      ),
    ],
    choices: alternatives.map((label, index) => ({
      id: String(index),
      label,
      features: { "magic.configured": {} },
      resolve(selection: FeatureSelection) {
        const systems = selection["magic.configured"].configuration!
          .magicSystems as unknown as MagicSystem[];
        requireThat(
          systems.some((entry) => entry.id === system),
          "magic_system",
          `Choose an existing magic system: ${system}.`
        );
        const patch = patches[index];
        const next = systems.map((entry) =>
          entry.id === system
            ? {
                ...entry,
                parameters: { ...entry.parameters, ...patch.parameters },
                effects: { ...entry.effects, ...patch.effects },
              }
            : entry
        );
        return {
          "magic.configured": {
            configuration: { magicSystems: next as unknown as ParameterValues[string] },
          },
        };
      },
    })),
  };
}

const degree = ["Subtle", "Pronounced", "Strong"];
export const magicCartography: CartographicControl[] = [
  control(
    "fire",
    "cores",
    "Core-site prevalence",
    "Core-site prevalence scales with land area; geothermal peaks and physical spacing determine which sites can form.",
    ["Isolated", "Scattered", "Plentiful"],
    [450, 300, 250].map((sourceThreshold, i) => ({
      parameters: {
        sourceThreshold,
        maximumSources: [32, 96, 160][i],
        sourceSpacing: [150_000, 90_000, 60_000][i],
      },
    }))
  ),
  control(
    "fire",
    "reach",
    "Thermal reach",
    "How far heat follows connected conductive veins from core sites.",
    ["Near veins", "Across districts", "Across regions"],
    [6, 3, 1.5].map((baseCost, i) => ({
      parameters: { baseCost, conductanceDivisor: [8, 12, 20][i] },
    }))
  ),
  control(
    "fire",
    "thaw",
    "Heat and quickening",
    "Thermal warming, ice melt, quickened life and fire exposure from the same Fire field.",
    ["Mild", "Pronounced", "Intense"],
    [0.09, 0.36, 0.72].map((heat, i) => ({
      effects: {
        heat,
        iceMelt: [0.125, 0.5, 1][i],
        quickening: [0.5, 1, 1][i],
        fire: [0.1, 0.3, 0.5][i],
      },
    }))
  ),
  control(
    "fire",
    "hardening",
    "Hardened terrain",
    "Heat-baked rock resists erosion and retains its landform imprint.",
    degree,
    [225, 900, 1800].map((rockResistance) => ({ effects: { rockResistance } }))
  ),
  control(
    "aurora",
    "terrain",
    "Charge-bearing terrain",
    "Cold and elevated terrain supplies charge to the coldward network.",
    ["Limited", "Widespread", "Extensive"],
    [280, 360, 420].map((baseInput) => ({ parameters: { baseInput } }))
  ),
  control(
    "aurora",
    "capture",
    "Ice-capture pattern",
    "Concentration in ice reservoirs versus continued transport toward colder ground.",
    ["Local reservoirs", "Intermediate", "Continued coldward flow"],
    [600, 1200, 1800].map((iceRetention, i) => ({
      parameters: { iceRetention, coldRetentionDistance: [4_000, 10_000, 18_000][i] },
    }))
  ),
  control(
    "aurora",
    "softening",
    "Softened terrain",
    "Aurora weakens rock, changing its response to weathering and erosion.",
    degree,
    [-130, -520, -1040].map((rockResistance) => ({ effects: { rockResistance } }))
  ),
  control(
    "pressure",
    "extent",
    "Ocean influence extent",
    "The reach and width of Pressure paths through connected ocean, coastal impulses and wakes.",
    ["Nearby", "Basin-spanning", "Far-reaching"],
    [1_200_000, 2_000_000, 3_600_000].map((rayDistance, i) => ({
      parameters: {
        rayDistance,
        rayDecay: [12, 8, 5][i],
        coastalRayDistance: [200_000, 300_000, 500_000][i],
        wakeDistance: [450_000, 700_000, 1_200_000][i],
        beamWidth: [14_000, 20_000, 26_000][i],
      },
    }))
  ),
  control(
    "pressure",
    "water",
    "Moved water",
    "Upwelling, cold sea surface and fog where a front shoals; warm still water in its wakes.",
    ["Faint", "Pronounced", "Strong"],
    [0.4, 1, 2].map((upwelling, i) => ({
      effects: {
        upwelling,
        seaSurface: [-0.04, -0.1, -0.2][i],
        wakeWarming: [10, 30, 60][i],
        fog: [0.3, 0.8, 1][i],
      },
    }))
  ),
  control(
    "pressure",
    "stress",
    "Coastal stress",
    "Additional coastal force where Pressure reaches the shore, combined with local waves and currents.",
    ["Subtle", "Pronounced", "Severe"],
    [0.25, 1, 2].map((coastalForcing) => ({ effects: { coastalForcing } }))
  ),
  control(
    "pressure",
    "wakes",
    "Ancient wake prevalence",
    "The prevalence of historical wake paths scales with ocean area; their physical travel distances stay fixed.",
    ["Sparse", "Scattered", "Frequent"],
    [8, 16, 32].map((wakeSources) => ({ parameters: { wakeSources } }))
  ),
  control(
    "pressure",
    "rogues",
    "Rogue-impact prevalence",
    "The prevalence of Pressure-driven coastal impulses scales with shoreline length in the geographic history.",
    ["Sparse", "Scattered", "Frequent"],
    [12, 24, 48].map((coastalSources) => ({ parameters: { coastalSources } }))
  ),
  control(
    "aurora",
    "stillness",
    "Stillness",
    "How far charged ice outlasts its climate and slows the life within it.",
    ["Faint", "Pronounced", "Strong"],
    [0.5, 0.9, 1].map((icePersistence, i) => ({
      effects: {
        icePersistence,
        stillness: [0.5, 1, 1][i],
        heat: [-0.02, -0.05, -0.1][i],
        organicPreservation: [0.8, 1.5, 2.5][i],
      },
    }))
  ),
  control(
    "greenwood",
    "stands",
    "Old-growth threshold",
    "How old and how closed a canopy, or how deep a peat, must be before it is a stand.",
    ["Ancient only", "Old growth", "Any mature wood"],
    [1600, 800, 400].map((standAge, i) => ({
      parameters: { standAge, standCover: [0.75, 0.6, 0.45][i], peatDepth: [20, 10, 5][i] },
    }))
  ),
  control(
    "greenwood",
    "roots",
    "Reach between roots",
    "How far Greenwood travels through connected living cover from its stands and springs.",
    ["Within the wood", "Across the country", "Across regions"],
    [12, 6, 3].map((rootCost, i) => ({
      parameters: { rootCost, rootFloor: [0.2, 0.12, 0.06][i] },
    }))
  ),
  control(
    "greenwood",
    "verdure",
    "Verdure",
    "Forest past its climate, deeper soil and braided rivers from the same Greenwood field.",
    degree,
    [0.5, 1, 1].map((verdure, i) => ({
      effects: { verdure },
      parameters: { groveSap: [1200, 600, 400][i] },
    }))
  ),
  control(
    "salt",
    "seep",
    "Brine seep",
    "How far brine travels down the drainage before the air flushes it or a pit crusts it.",
    ["Short", "Down the valley", "To the basin floor"],
    [0.3, 0.5, 0.7].map((seepShare, i) => ({
      parameters: { seepShare, brineFlush: [0.8, 0.6, 0.4][i] },
    }))
  ),
  control(
    "salt",
    "dust",
    "Salt dust",
    "How much of an exposed bed the wind lifts and how far it blows before it settles.",
    ["Still", "Blowing", "Storm-borne"],
    [0.05, 0.15, 0.3].map((dustShare, i) => ({
      parameters: { dustShare, dustSettle: [0.7, 0.5, 0.3][i] },
    }))
  ),
  control(
    "salt",
    "glass",
    "Glass flats and drying",
    "How deep a bed fuses the pan to glass, and how much the air dries over salted ground.",
    degree,
    [1200, 800, 500].map((glassBed, i) => ({
      parameters: { glassBed, desiccation: [0.3, 0.5, 0.7][i] },
    }))
  ),
  control(
    "hallowed",
    "reach",
    "Sanctuary reach",
    "How wide a ring a long-kept seat wards, and how long a seat must be kept to ward one.",
    ["Close", "District", "Province"],
    [20_000, 40_000, 80_000].map((wardReach, i) => ({
      parameters: { wardReach, tenureFull: [300_000_000, 150_000_000, 75_000_000][i] },
    }))
  ),
  control(
    "hallowed",
    "lines",
    "Kept lines and pilgrim roads",
    "How many kept years make a frontier a ward line, and how worn a way must be to be a pilgrimage road.",
    ["Rare", "Common", "Everywhere"],
    [20_000, 10_000, 5000].map((lineFull, i) => ({
      parameters: { lineFull, roadFull: [20_000_000, 10_000_000, 5_000_000][i] },
    }))
  ),
  control(
    "hallowed",
    "warding",
    "Warding",
    "How much of every other system a ring removes inside and lays on its rim, and how hard the rock holds within.",
    degree,
    [0.5, 1, 1].map((warding, i) => ({
      effects: { warding, rockResistance: [150, 300, 600][i] },
    }))
  ),
  control(
    "veil",
    "tearing",
    "Tearing",
    "How much strain between systems tears the ground, and how much makes a full tear.",
    ["Only at the fiercest fronts", "At strong fronts", "At any front"],
    [0.1, 0.05, 0.02].map((tearFloor, i) => ({
      parameters: { tearFloor, tearFull: [0.5, 0.4, 0.25][i] },
    }))
  ),
  control(
    "veil",
    "doors",
    "Doors",
    "How strong and how far apart stable tears must be to pair into a door, and how many a world holds.",
    ["Few and far", "Some", "Many"],
    [600, 400, 250].map((doorStrain, i) => ({
      parameters: {
        doorStrain,
        doorDistance: [600_000, 300_000, 150_000][i],
        doorCount: [3, 6, 12][i],
      },
    }))
  ),
  control(
    "veil",
    "wildness",
    "Wild zones",
    "How far a wild zone moves its ground and its cover between surveys.",
    degree,
    [10, 20, 40].map((wildRelief, i) => ({
      parameters: { wildRelief, wildShuffle: [0.15, 0.3, 0.5][i] },
    }))
  ),
];
