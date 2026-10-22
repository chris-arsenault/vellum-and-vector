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
    "The distribution of geothermal core sites; the landscape determines which sites can form.",
    ["Isolated", "Scattered", "Plentiful"],
    [650, 500, 400].map((sourceThreshold, i) => ({
      parameters: {
        sourceThreshold,
        maximumSources: [24, 48, 96][i],
        sourceSpacing: [120_000, 90_000, 60_000][i],
      },
    }))
  ),
  control(
    "fire",
    "reach",
    "Thermal reach",
    "How far heat follows connected conductive veins from core sites.",
    ["Near veins", "Across districts", "Across regions"],
    [12, 6, 2].map((baseCost, i) => ({
      parameters: { baseCost, conductanceDivisor: [16, 26, 40][i] },
    }))
  ),
  control(
    "fire",
    "thaw",
    "Heat and thaw",
    "Thermal warming, ice melt and fire exposure from the same Fire field.",
    ["Mild", "Pronounced", "Intense"],
    [0.09, 0.36, 0.72].map((heat, i) => ({
      effects: { heat, iceMelt: [0.125, 0.5, 1][i], fire: [0.2, 0.8, 1][i] },
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
    [1_200_000, 2_200_000, 3_600_000].map((rayDistance, i) => ({
      parameters: {
        rayDistance,
        coastalRayDistance: [400_000, 700_000, 1_100_000][i],
        wakeDistance: [600_000, 1_000_000, 1_600_000][i],
        beamWidth: [12_000, 18_000, 24_000][i],
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
    "The prevalence of historical wake paths, not a queue of new disasters.",
    ["Sparse", "Scattered", "Frequent"],
    [130, 260, 520].map((wakeSources) => ({ parameters: { wakeSources } }))
  ),
  control(
    "pressure",
    "rogues",
    "Rogue-impact prevalence",
    "The prevalence of Pressure-driven coastal impulses in the geographic history.",
    ["Sparse", "Scattered", "Frequent"],
    [100, 200, 400].map((coastalSources) => ({ parameters: { coastalSources } }))
  ),
];
