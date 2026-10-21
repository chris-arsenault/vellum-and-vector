import { requireThat, type Epoch } from "@atlas/domain";
import { draftEpochs, updatePhysicalEpoch, updateEcologyEpoch } from "./generationDraftEpochs";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import type { GenerationDraft } from "./generationDraft";

export function selectedDraftEpoch(flow: Pick<GenerationWorkflow, "draft" | "epoch">) {
  const epochs = draftEpochs(flow.draft);
  const selected = epochs.find((epoch) => epoch.id === flow.epoch) ?? epochs[0];
  requireThat(selected, "draft_epoch", "Keep at least one shared epoch.");
  return selected;
}

export function epochFieldPrefix(owner: string, id: string) {
  return `feature.${owner}.epochs.${encodeURIComponent(id).replaceAll(".", "%2E")}.`;
}

type EpochValueKey =
  | "tectonics"
  | "hydrology"
  | "ice"
  | "coasts"
  | "impacts"
  | "volcanism"
  | "temperature"
  | "rainfall"
  | "seaLevel";
export interface EpochControl {
  key: EpochValueKey;
  label: string;
  unit: string;
  min?: number;
  max?: number;
}
const strength = (key: EpochValueKey, label: string): EpochControl => ({
  key,
  label,
  unit: "multiplier",
  min: 0,
  max: 1,
});
const controls: Record<string, EpochControl[]> = {
  "physical.tectonic-history": [strength("tectonics", "Epoch tectonic activity")],
  "physical.mountains": [strength("tectonics", "Epoch tectonic activity")],
  "physical.fractures": [strength("tectonics", "Epoch tectonic activity")],
  "ocean.geography": [{ key: "seaLevel", label: "Epoch sea level offset", unit: "m" }],
  "physical.volcanism": [
    { key: "volcanism", label: "Epoch volcanic activity", unit: "multiplier", min: 0 },
  ],
  "physical.impacts": [
    { key: "impacts", label: "Epoch impact activity", unit: "multiplier", min: 0 },
  ],
  "physical.climate": [
    { key: "temperature", label: "Epoch temperature shift", unit: "°C" },
    { key: "rainfall", label: "Epoch rainfall", unit: "multiplier", min: 0, max: 5 },
  ],
  "physical.river-incision": [strength("hydrology", "Epoch hydrological activity")],
  "physical.land-ice": [
    strength("ice", "Epoch glacial activity"),
    strength("hydrology", "Epoch hydrological activity"),
  ],
  "physical.glacial-sculpting": [strength("ice", "Epoch glacial activity")],
  "physical.coastal-evolution": [strength("coasts", "Epoch coastal activity")],
};
export function physicalEpochControls(id: string) {
  return controls[id] ?? [];
}
export function epochControlValue(epoch: Epoch, control: EpochControl) {
  if (control.key === "rainfall") return epoch.ecology?.rainfall ?? 1;
  return control.key === "temperature" ? epoch.temperature - 15 : epoch[control.key]!;
}
export function changeEpochControl(
  draft: GenerationDraft,
  epoch: string,
  key: EpochValueKey,
  value: number
) {
  if (key === "rainfall") return updateEcologyEpoch(draft, epoch, { rainfall: value });
  return updatePhysicalEpoch(draft, epoch, { [key]: key === "temperature" ? value + 15 : value });
}
