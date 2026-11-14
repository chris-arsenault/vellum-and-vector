import type { CartographicControl } from "./generationTypes";
import { atlasFeatureDefinitions, controlFeatures } from "./generationPresentation";
import type { GenerationDraft } from "./generationDraft";
import type { GenerationWorkflow } from "./useGenerationWorkflow";

export function cartographicControls() {
  return atlasFeatureDefinitions.flatMap((feature) => feature.cartography ?? []);
}
export function visibleCartographicControls(inherited: boolean, draft?: GenerationDraft) {
  return cartographicControls()
    .filter((control) => !inherited || !control.initialOnly)
    .filter((control) => !draft || controlAvailable(draft, control))
    .map((control) => ({
      ...control,
      choices: control.choices.filter((choice) => !inherited || !choice.initialOnly),
    }));
}
function controlAvailable(draft: GenerationDraft, control: CartographicControl) {
  const owner = atlasFeatureDefinitions.find((feature) =>
    feature.cartography?.some((entry) => entry.id === control.id)
  )!;
  if (
    !draft.recipe.features![owner.id]?.enabled ||
    !owner.domains.some((domain) =>
      draft.recipe.domains.includes(domain as GenerationDraft["recipe"]["domains"][number])
    )
  )
    return false;
  if (!control.system) return true;
  const systems = draft.recipe.features![owner.id].configuration!.magicSystems as unknown as {
    id: string;
  }[];
  return systems.some((system) => system.id === control.system);
}
export function cartographicValue(flow: GenerationWorkflow, control: CartographicControl) {
  return flow.cartography[control.id] ?? "custom";
}
export function cartographicFieldPending(
  control: CartographicControl,
  errors: Record<string, string>
) {
  if (control.fields?.some((field) => errors[field])) return true;
  return control.choices.some((choice) =>
    Object.entries(choice.features).some(
      ([id, patch]) =>
        patch.settings &&
        Object.keys(patch.settings).some((key) => Boolean(errors["feature." + id + "." + key]))
    )
  );
}
export function cartographicFeatureStage(id: string) {
  const control = cartographicControls().find((control) => controlFeatures(control).includes(id));
  return control?.system ? "magic" : (control?.section ?? "environment");
}
