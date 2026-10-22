import {
  atlasGenerationModules,
  controlFeatures,
  matchCartographicChoice,
  mergeCartographicConfiguration,
  type CartographicControl,
  type FeatureSelection,
} from "@atlas/generation";
import { requireThat } from "@atlas/domain";
import { updateFeature, type GenerationDraft } from "./generationDraft";

export function cartographicControls() {
  return atlasGenerationModules.features().flatMap((feature) => feature.cartography ?? []);
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
  const owner = atlasGenerationModules
    .features()
    .find((feature) => feature.cartography?.some((entry) => entry.id === control.id))!;
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

export function cartographicValue(draft: GenerationDraft, control: CartographicControl) {
  const selection: FeatureSelection = {};
  for (const feature of atlasGenerationModules.features()) {
    const configured = draft.recipe.features?.[feature.id];
    selection[feature.id] = {
      ...configured,
      enabled:
        Boolean(configured?.enabled) &&
        feature.domains.some((domain) =>
          draft.recipe.domains.includes(domain as (typeof draft.recipe.domains)[number])
        ),
    };
  }
  return matchCartographicChoice(control, selection)?.id ?? "custom";
}

/** Unfinished numeric input affects only controls that actually write that value. */
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

export function applyCartographicChoice(
  draft: GenerationDraft,
  control: CartographicControl,
  value: string
) {
  const selected = control.choices.find((item) => item.id === value);
  requireThat(selected, "cartographic_choice", "Choose a supported cartographic option.");
  let next = draft;
  const patches = selected.resolve?.(draft.recipe.features!) ?? selected.features;
  for (const [id, patch] of Object.entries(patches)) {
    const merged = { ...patch };
    if (patch.configuration !== undefined)
      merged.configuration = mergeCartographicConfiguration(
        next.recipe.features![id].configuration!,
        patch.configuration
      );
    next = updateFeature(next, id, merged);
  }
  const visited = new Set<string>();
  const requireFeature = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const feature = atlasGenerationModules.features().find((entry) => entry.id === id);
    requireThat(feature, "cartographic_feature", `Unknown cartographic feature ${id}.`);
    for (const prerequisite of feature.requires ?? []) {
      next = updateFeature(next, prerequisite, { enabled: true });
      requireFeature(prerequisite);
    }
  };
  for (const [id, patch] of Object.entries(patches)) if (patch.enabled) requireFeature(id);
  return next;
}

export function cartographicFeatureStage(id: string) {
  return (
    cartographicControls().find((control) => controlFeatures(control).includes(id))?.section ??
    "environment"
  );
}
