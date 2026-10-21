import type { FeatureContributionContext } from "./features";
import type { ProcessInvocation, ProcessSequence } from "./process";
import type { GenerationSlot } from "./generationSlots";

export function operation(
  process: string,
  version = "0f62584c",
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
export const configuredMagicOperations: Partial<Record<GenerationSlot, string>> = {
  "initialize.influences": "initialize",
  "epoch.climate-forcing": "climate",
  "epoch.material-forcing": "rocks",
  "epoch.post-glacial-forcing": "post-glacial",
  "epoch.influence-history": "history",
  "epoch.coastal-forcing": "coast",
  "present.climate-forcing": "climate",
  "present.material-forcing": "rocks",
  "present.post-glacial-forcing": "post-glacial",
  "present.influence-history": "history",
  "present.classify": "classify",
  "present.project": "project",
};
export const localMagicSlots = ["before.model-pass", "after.model-pass", "epoch.storage"] as const;
export const localMagicProcesses = [
  "magic.thermal",
  "magic.material",
  "magic.advanceStorage",
  "magic.advection",
  "canonry.temperature",
  "canonry.project-forcing",
  "canonry.forcing",
];

export function localMagicContribution(
  slot: string,
  context?: FeatureContributionContext
): ProcessSequence {
  if (!context || !context.source.world.magic.some((source) => !source.systemId)) return [];
  if (slot === "epoch.storage") return [operation("magic.advanceStorage", "1")];
  if (slot === "after.model-pass" && context.process === "canonry.plate-advection")
    return [operation("magic.advection")];
  if (slot !== "before.model-pass" || context.process !== "canonry.temperature") return [];
  return [
    operation("canonry.temperature", "0f62584c", { unforced: true }),
    operation("canonry.project-forcing"),
    operation("magic.thermal", "1"),
    ...(context.material ? [operation("magic.material", "1")] : []),
    operation("canonry.forcing"),
  ];
}
