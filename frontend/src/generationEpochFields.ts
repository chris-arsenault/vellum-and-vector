import { requireThat, type Epoch } from "@atlas/domain";
import { draftEpochs, updatePhysicalEpoch, updateEcologyEpoch } from "./generationDraftEpochs";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import type { GenerationDraft } from "./generationDraft";
import {
  atlasFeatureDefinitions,
  type EpochControl,
  type EpochValueKey,
  type SetupFeature,
} from "@atlas/generation";

export function selectedDraftEpoch(flow: Pick<GenerationWorkflow, "draft" | "epoch">) {
  const epochs = draftEpochs(flow.draft);
  const selected = epochs.find((epoch) => epoch.id === flow.epoch) ?? epochs[0];
  requireThat(selected, "draft_epoch", "Keep at least one shared epoch.");
  return selected;
}

export function epochFieldPrefix(owner: string, id: string) {
  return `feature.${owner}.epochs.${encodeURIComponent(id).replaceAll(".", "%2E")}.`;
}

export function physicalEpochControls(feature: string | Pick<SetupFeature, "id" | "presentation">) {
  const presentation =
    typeof feature === "string"
      ? atlasFeatureDefinitions.find((entry) => entry.id === feature)?.presentation
      : feature.presentation;
  return presentation?.epochControls ?? [];
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
