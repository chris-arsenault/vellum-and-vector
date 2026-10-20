import { requireThat, ecologyLabels, type Diagnostic, type MagicSystem } from "@atlas/domain";
import type { ProcessSequence } from "./process";
import { optionalProcesses } from "./processCatalogue";
import { nativeContracts } from "./canonry/contracts";

export type ProcessSelection = Record<string, boolean>;
export function processEnabled(selection: ProcessSelection, id: string): boolean {
  if (id.startsWith("atlas.ecology-")) return selection["atlas.ecology-evolve"] !== false;
  return selection[id] !== false;
}
export function selectedSequence(
  sequence: ProcessSequence,
  selection: ProcessSelection
): ProcessSequence {
  return sequence
    .filter((node) => node.kind === "epochs" || processEnabled(selection, node.process))
    .map((node) =>
      node.kind === "epochs" ? { ...node, body: selectedSequence(node.body, selection) } : node
    );
}
const optionalFacts: Record<string, string[]> = {
  "canonry.impact-cratering": ["Impacts"],
  "canonry.volcanic-construction": ["VolcanicConstruction"],
  "canonry.coastal-erosion-and-deposition": ["CoastalEvolution"],
  "canonry.glacial-erosion": ["GlacialEvolution"],
  "canonry.river-floodplains": ["Floodplains"],
  "canonry.river-delta-formation": ["Deltas"],
};
/** Absent event histories are initialized numerical inputs, not produced events. */
export function selectedNativeContract(
  name: string,
  selection: ProcessSelection,
  inheritedAbsences: string[] = []
) {
  const source = nativeContracts[name];
  const absent = new Set([
    ...inheritedAbsences,
    ...Object.entries(optionalFacts).flatMap(([id, facts]) =>
      selection[id] === false ? facts : []
    ),
  ]);
  // A delta needs a generated floodplain; it is a selectable dependency, not an absence fallback.
  if (name === "river-delta-formation") absent.delete("Floodplains");
  return { ...source, requires: source.requires.filter((fact) => !absent.has(fact)) };
}
export function selectionDiagnostics(selection: ProcessSelection, known: string[]): Diagnostic[] {
  for (const [id, value] of Object.entries(selection)) {
    requireThat(typeof value === "boolean", "process_selection", `Use true or false for ${id}.`);
    requireThat(known.includes(id), "unknown_process", `Unknown process ${id}.`);
    requireThat(
      value || Object.hasOwn(optionalProcesses, id),
      "required_process",
      `${id} is required for its selected profile.`
    );
  }
  const errors: Diagnostic[] = [];
  const erosion = processEnabled(selection, "canonry.glacial-erosion");
  const deposition = processEnabled(selection, "canonry.glacial-deposition");
  if (erosion !== deposition)
    errors.push({
      code: "coupled_processes",
      severity: "error",
      invocation: "glacial sculpting",
      resource: "canonry.glacial-erosion",
      message:
        "Glacial erosion and deposition work together to conserve sediment. Enable or disable both.",
    });
  return errors;
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
