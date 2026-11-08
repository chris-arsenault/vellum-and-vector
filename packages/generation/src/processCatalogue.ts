import type { MapProcessContract } from "./process";
import { atlasGenerationModules } from "./atlasModules";

export interface ProcessDescription {
  label: string;
  group: string;
  help: string;
  selectable: boolean;
  role: string;
}
export function describeProcess(contract: MapProcessContract): ProcessDescription {
  const feature = atlasGenerationModules
    .features()
    .find((definition) => definition.processes.includes(contract.id));
  return {
    label: readableName(contract.id),
    group: processGroup(contract.id),
    help: feature
      ? `An operation of ${feature.label}. Selection and settings belong to that feature.`
      : `Establishes or reconciles ${contract.produces.join(", ") || "the shared working state"} for its requesting features.`,
    selectable: Boolean(feature),
    role: temporalRole(contract.id),
  };
}
function readableName(id: string) {
  const name = id.slice(id.indexOf(".") + 1).replaceAll("-", " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}
function processGroup(id: string) {
  if (id.includes("ecology")) return "Life";
  if (id.includes("magic") || id.startsWith("magic.")) return "Magic";
  if (id.startsWith("human.") || id.startsWith("built.")) return "People";
  return "Physical foundations";
}
function temporalRole(id: string) {
  if (["atlas.ecology-evolve", "atlas.ecology-respond"].includes(id))
    return "Half-epoch biological response";
  if (id === "atlas.ecology-burial") return "Epoch carbon burial and thermal exposure";
  if (id === "atlas.ecology-present") return "Present reconciliation; no elapsed biological age";
  if (id.includes("initialize")) return "Initialization";
  if (id.includes("project") || id.includes("features")) return "Publication";
  return "Ordered causal process";
}
