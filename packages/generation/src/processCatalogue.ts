import type { MapProcessContract } from "./process";
import { atlasGenerationModules } from "./atlasModules";

/** Legacy wizard aliases only. Execution uses feature definitions and contributions. */
export const optionalProcesses: Record<string, { label: string; group: string; help: string }> = {
  "canonry.impact-cratering": {
    label: "Meteor impacts",
    group: "Geology",
    help: "Excavate impact basins, rims and ejecta through the configured history.",
  },
  "canonry.volcanic-construction": {
    label: "Volcanic construction",
    group: "Geology",
    help: "Build volcanic relief from tectonic and plume sources.",
  },
  "canonry.ancestral-fluvial-erosion": {
    label: "River erosion",
    group: "Water",
    help: "Cut terrain and supply sediment. Rivers and drainage can still be generated without incision.",
  },
  "canonry.glacial-erosion": {
    label: "Glacial erosion",
    group: "Ice",
    help: "Excavate terrain beneath moving grounded ice.",
  },
  "canonry.glacial-deposition": {
    label: "Glacial deposition",
    group: "Ice",
    help: "Deposit sediment carried by ice. Requires glacial erosion to supply its evolution contract.",
  },
  "canonry.coastal-erosion-and-deposition": {
    label: "Coastal evolution",
    group: "Water",
    help: "Move coastal sediment and reshape shores under waves and forcing.",
  },
  "canonry.river-floodplains": {
    label: "Floodplain classification",
    group: "Water",
    help: "Identify floodplain geography beside the final river network.",
  },
  "canonry.river-delta-formation": {
    label: "Delta classification",
    group: "Water",
    help: "Identify deltas from river sediment, coast and floodplain inputs.",
  },
  "atlas.ecology-evolve": {
    label: "Living ecology",
    group: "Life",
    help: "Evolve vegetation, soils, animals and organic matter in two half-epoch responses, then derive present biomes.",
  },
};

export interface ProcessDescription {
  label: string;
  group: string;
  help: string;
  selectable: boolean;
  role: string;
}
export function describeProcess(contract: MapProcessContract): ProcessDescription {
  const option = optionalProcesses[contract.id];
  const feature = atlasGenerationModules
    .features()
    .find((definition) => definition.processes.includes(contract.id));
  return {
    label: option?.label ?? readableName(contract.id),
    group: option?.group ?? processGroup(contract.id),
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
