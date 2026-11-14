import type { EcologyEpoch, Epoch, MagicConfluence, MagicSystem, HumanEra } from "@atlas/context";
import type { ParameterValues } from "./generationTypes";
import { requireFormValue } from "./values";
import { updateFeature, type GenerationDraft } from "./generationDraft";
import { rebindDraftEpochs } from "./generationEpochBindings";
import { defaultEpoch, beforePresentEpoch } from "./generationPresentation";

type PhysicalEpochPatch = Partial<Omit<Epoch, "id" | "ecology" | "magicActivity">>;

function configuration(draft: GenerationDraft, feature: string) {
  return draft.recipe.features![feature].configuration!;
}

function physicalEpoch({ ecology: _ecology, magicActivity: _magic, ...physical }: Epoch) {
  void _ecology;
  void _magic;
  return physical;
}

/** A derived view of the shared clock and its feature-owned regimes. */
export function draftEpochs(draft: GenerationDraft): Epoch[] {
  return draft.recipe.settings.epochs;
}

export function replaceDraftEpochs(
  draft: GenerationDraft,
  epochs: Epoch[],
  identities: Record<string, string> = {}
): GenerationDraft {
  const parsed = epochs;
  requireFormValue(
    parsed.length > 0 && parsed.every((epoch) => epoch.id.trim()),
    "Keep at least one named epoch."
  );
  requireFormValue(
    new Set(parsed.map((epoch) => epoch.id)).size === parsed.length,
    "Use unique history names."
  );
  const features = rebindDraftEpochs(draft.recipe.features!, parsed, identities);
  const cultures = features["human.cultures"];
  const eras = cultures.configuration!.eras as unknown as HumanEra[];
  features["human.cultures"] = {
    ...cultures,
    configuration: {
      ...cultures.configuration,
      eras: eras.map((era) => ({
        ...era,
        // A structural binding follows the schedule by itself; a named one follows its epoch.
        physicalEpoch:
          era.physicalEpoch === beforePresentEpoch
            ? beforePresentEpoch
            : (parsed.find((epoch) => (identities[epoch.id] ?? epoch.id) === era.physicalEpoch)
                ?.id ?? null),
      })),
    },
  };
  if (!Object.keys(identities).length) {
    features["physical.lifecycle"].configuration!.history = null;
    features["ecology.living"].configuration!.landscape = null;
    features["ecology.living"].configuration!.glaciated = false;
  }
  return {
    ...draft,
    recipe: {
      ...draft.recipe,
      settings: { ...draft.recipe.settings, epochs: parsed },
      features,
    },
  };
}

function changeEpoch(
  draft: GenerationDraft,
  id: string,
  change: (epoch: Epoch) => Epoch,
  identities: Record<string, string> = {}
) {
  const epochs = draftEpochs(draft);
  requireFormValue(
    epochs.some((epoch) => epoch.id === id),
    `Choose an existing epoch: ${id}.`
  );
  return replaceDraftEpochs(
    draft,
    epochs.map((epoch) => (epoch.id === id ? change(epoch) : epoch)),
    identities
  );
}

export function updatePhysicalEpoch(draft: GenerationDraft, id: string, patch: PhysicalEpochPatch) {
  const epochs = draftEpochs(draft);
  requireFormValue(
    epochs.some((epoch) => epoch.id === id),
    `Choose an existing epoch: ${id}.`
  );
  const next = updateFeature(draft, "physical.lifecycle", {
    configuration: {
      history: null,
      epochs: epochs.map((epoch) =>
        physicalEpoch(epoch.id === id ? { ...epoch, ...patch } : epoch)
      ),
    },
  });
  next.recipe.settings = {
    ...draft.recipe.settings,
    epochs: epochs.map((epoch) => (epoch.id === id ? { ...epoch, ...patch } : epoch)),
  };
  return next;
}

export function renameDraftEpoch(draft: GenerationDraft, id: string, nextId: string) {
  const target = nextId.trim();
  return changeEpoch(draft, id, (epoch) => ({ ...epoch, id: target }), { [target]: id });
}

export function insertDraftEpoch(draft: GenerationDraft, index: number, id: string) {
  const epochs = draftEpochs(draft);
  requireFormValue(
    Number.isInteger(index) && index >= 0 && index <= epochs.length,
    "Choose an insertion position in the shared history."
  );
  const next = [...epochs];
  next.splice(index, 0, { ...defaultEpoch(), id });
  return replaceDraftEpochs(draft, next);
}

export function deleteDraftEpoch(draft: GenerationDraft, id: string) {
  const epochs = draftEpochs(draft);
  requireFormValue(
    epochs.some((epoch) => epoch.id === id),
    `Choose an existing epoch: ${id}.`
  );
  return replaceDraftEpochs(
    draft,
    epochs.filter((epoch) => epoch.id !== id)
  );
}

export function moveDraftEpoch(draft: GenerationDraft, id: string, index: number) {
  const epochs = [...draftEpochs(draft)],
    previous = epochs.findIndex((epoch) => epoch.id === id);
  requireFormValue(
    previous >= 0 && Number.isInteger(index) && index >= 0 && index < epochs.length,
    "Choose an existing epoch and history position."
  );
  const [epoch] = epochs.splice(previous, 1);
  epochs.splice(index, 0, epoch);
  return replaceDraftEpochs(draft, epochs);
}

export function updateEcologyEpoch(
  draft: GenerationDraft,
  id: string,
  patch: Partial<EcologyEpoch>
) {
  requireFormValue(
    draftEpochs(draft).some((epoch) => epoch.id === id),
    `Choose an existing epoch: ${id}.`
  );
  const epochs = Object.fromEntries(
    draftEpochs(draft).map((epoch) => [epoch.id, epoch.ecology ?? {}])
  );
  const next = updateFeature(draft, "ecology.living", {
    configuration: {
      landscape: null,
      glaciated: false,
      epochs: { ...epochs, [id]: { ...epochs[id], ...patch } },
    },
  });
  next.recipe.settings = {
    ...draft.recipe.settings,
    epochs: draftEpochs(draft).map((epoch) =>
      epoch.id === id ? { ...epoch, ecology: { ...epoch.ecology!, ...patch } } : epoch
    ),
  };
  return next;
}

export function updateMagicActivity(
  draft: GenerationDraft,
  id: string,
  system: string,
  value: number
) {
  requireFormValue(
    draftEpochs(draft).some((epoch) => epoch.id === id),
    `Choose an existing epoch: ${id}.`
  );
  const activity = configuration(draft, "magic.configured").activity as Record<
    string,
    Record<string, number>
  >;
  return updateFeature(draft, "magic.configured", {
    configuration: {
      activity: { ...activity, [id]: { ...activity[id], [system]: value } },
    },
  });
}

export function setDraftConfluences(draft: GenerationDraft, confluences: MagicConfluence[]) {
  return updateFeature(draft, "magic.configured", {
    configuration: {
      ...configuration(draft, "magic.configured"),
      confluences: confluences as unknown as ParameterValues[string],
    },
  });
}
export function setDraftMagicSystems(draft: GenerationDraft, systems: MagicSystem[]) {
  const ids = new Set(systems.map((system) => system.id));
  const previous = configuration(draft, "magic.configured").activity as Record<
    string,
    Record<string, number>
  >;
  const activity = Object.fromEntries(
    Object.entries(previous).map(([epoch, values]) => [
      epoch,
      Object.fromEntries(Object.entries(values).filter(([id]) => ids.has(id))),
    ])
  );
  return updateFeature(draft, "magic.configured", {
    configuration: {
      magicSystems: systems as unknown as ParameterValues[string],
      activity,
    },
  });
}
