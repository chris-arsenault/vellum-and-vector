import { ecologyLabels, type Diagnostic, type MagicSystem } from "@atlas/domain";

export type ProcessSelection = Record<string, boolean>;
export function processEnabled(selection: ProcessSelection, id: string): boolean {
  if (id.startsWith("atlas.ecology-")) return selection["atlas.ecology-evolve"] !== false;
  return selection[id] !== false;
}
export function ecologicalMagicDiagnostics(
  selection: ProcessSelection,
  domains: string[],
  systems: MagicSystem[]
): Diagnostic[] {
  if (processEnabled(selection, "atlas.ecology-evolve") || !domains.includes("magic")) return [];
  if (!systems.some((system) => system.enabled && needsEcology(system))) return [];
  return [
    {
      code: "ecological_magic",
      severity: "error",
      invocation: "Magical systems",
      resource: "atlas.ecology-evolve",
      message:
        "Enabled magical ecological effects or landmark conditions require Living ecology. Enable it, disable magic, or remove those effects and conditions.",
    },
  ];
}
function needsEcology(system: MagicSystem) {
  const keys = [
    "vegetationGrowth",
    "fire",
    "organicPreservation",
    "ecologicalAlteration",
    "plantColdTolerance",
    "plantDroughtTolerance",
    "animalToxicity",
    "seedDispersal",
  ] as const;
  const effects = keys.some((key) => system.effects[key] !== 0);
  const conditions = system.features
    .flatMap((feature) => [...feature.seeds, ...(feature.retains ?? [])])
    .flat();
  return effects || conditions.some((condition) => Object.hasOwn(ecologyLabels, condition.field));
}
