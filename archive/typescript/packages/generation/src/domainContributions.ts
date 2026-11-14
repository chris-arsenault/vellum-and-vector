import type { FeatureContributionContext } from "./features";
import type { ProcessInvocation, ProcessSequence } from "./process";
import type { GenerationSlot } from "./generationSlots";

export function operation(
  process: string,
  version = "1",
  parameters: ProcessInvocation["parameters"] = {}
): ProcessInvocation {
  return { kind: "process", id: process, process, version, parameters };
}
export const ecologyOperations: Partial<Record<GenerationSlot, string>> = {
  "initialize.ecology": "initialize",
  "epoch.ecology-evolve": "evolve",
  "epoch.ecology-respond": "respond",
  "epoch.ecology-burial": "burial",
  "present.ecology": "present",
};
export const regionalEcologyOperations: Partial<Record<GenerationSlot, string>> = {
  "initialize.ecology": "refinement.ecology-initialize",
  "epoch.ecology-evolve": "refinement.ecology-develop",
  "present.ecology": "refinement.ecology-present",
};
export const regionalMagicOperations: Partial<Record<GenerationSlot, string>> = {
  "epoch.climate-forcing": "refinement.magic-refresh",
  "present.climate-forcing": "refinement.magic-refresh",
  "epoch.material-forcing": "refinement.magic-react",
  "epoch.post-glacial-forcing": "refinement.magic-transport",
  "epoch.ecology-burial": "refinement.magic-organic",
  "present.classify": "refinement.magic-map",
};
export const configuredMagicOperations: Partial<Record<GenerationSlot, string>> = {
  "initialize.influences": "initialize",
  "epoch.climate-forcing": "climate",
  "epoch.material-forcing": "rocks",
  "epoch.post-glacial-forcing": "post-glacial",
  "epoch.influence-history": "history",
  "epoch.coastal-forcing": "coast",
  "present.climate-forcing": "climate",
  "present.post-glacial-forcing": "post-glacial",
  "present.classify": "classify",
  "present.project": "project",
};
export const localMagicSlots = [
  "before.model-pass",
  "after.model-pass",
  "epoch.storage",
  "epoch.material-forcing",
] as const;
export const localMagicProcesses = [
  "magic.thermal",
  "magic.material",
  "magic.advanceStorage",
  "magic.advection",
  "atlas.atmospheric-climate",
  "atlas.project-forcing",
  "atlas.forcing",
];

type LocalMagicContext = Pick<FeatureContributionContext, "execution" | "process" | "material"> & {
  source: { world: { magic: readonly { systemId?: string | null }[] } };
};

export function localMagicContribution(slot: string, context?: LocalMagicContext): ProcessSequence {
  if (!context || !context.source.world.magic.some((source) => !source.systemId)) return [];
  if (context.execution === "regional") return regionalLocalMagic(slot, context);
  if (slot === "epoch.storage") return [operation("magic.advanceStorage", "1")];
  if (slot === "after.model-pass" && context.process === "atlas.plate-advection")
    return [operation("magic.advection")];
  if (slot !== "before.model-pass" || context.process !== "atlas.atmospheric-climate") return [];
  return [
    {
      ...operation("atlas.forcing", "1", { includeStandalone: false }),
      id: "atlas.forcing.without-standalone",
    },
    operation("atlas.atmospheric-climate"),
    operation("atlas.project-forcing"),
    operation("magic.thermal", "1"),
    ...(context.material ? [operation("magic.material", "1", { react: true })] : []),
    operation("atlas.forcing"),
  ];
}

function regionalLocalMagic(slot: string, context: LocalMagicContext): ProcessSequence {
  if (slot === "epoch.material-forcing")
    return [
      operation("atlas.project-forcing"),
      operation("magic.material", "1", { react: true }),
      operation("atlas.forcing"),
    ];
  return slot === "before.model-pass" && context.process === "refinement.climate"
    ? [
        {
          ...operation("atlas.forcing", "1", { includeStandalone: false }),
          id: "atlas.forcing.without-standalone",
        },
        operation("refinement.climate"),
        operation("atlas.project-forcing"),
        operation("magic.thermal"),
        operation("magic.material"),
        operation("atlas.forcing"),
      ]
    : [];
}
