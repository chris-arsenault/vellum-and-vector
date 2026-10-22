import {
  requireThat,
  type EcologyEpoch,
  type Epoch,
  type MagicSystem,
  type ParameterValues,
} from "@atlas/domain";
import {
  generationEpochSchema,
  terrainEpochs,
  landscapeEpoch,
  type TerrainHistory,
} from "@atlas/generation";
import { defaultEpochs } from "./atlasState";
import { normalizeGenerationDraft, updateFeature, type GenerationDraft } from "./generationDraft";
import { draftEpochBindings, sharedClock, rebindDraftEpochs } from "./generationEpochBindings";

type PhysicalEpochPatch = Partial<Omit<Epoch, "id" | "ecology" | "magicActivity">>;

function configuration(draft: GenerationDraft, feature: string) {
  const normalized = draft.recipe.features ? draft : normalizeGenerationDraft(draft);
  return normalized.recipe.features![feature].configuration!;
}

function physicalEpoch({ ecology: _ecology, magicActivity: _magic, ...physical }: Epoch) {
  void _ecology;
  void _magic;
  return physical;
}

/** A derived view of the shared clock and its feature-owned regimes. */
export function draftEpochs(draft: GenerationDraft): Epoch[] {
  const selection = draft.recipe.features ?? normalizeGenerationDraft(draft).recipe.features!;
  const epochs = sharedClock(selection).map((epoch) => {
    const combined = structuredClone(epoch);
    for (const binding of draftEpochBindings()) {
      if (!binding.extension) continue;
      const records = selection[binding.id].configuration![binding.path] as Record<
        string,
        ParameterValues
      >;
      Object.assign(combined, { [binding.extension]: structuredClone(records[epoch.id] ?? {}) });
    }
    return combined;
  });
  const history = selection["physical.lifecycle"].configuration!.history as TerrainHistory | null;
  const physical = history
    ? terrainEpochs(epochs, history, selection["physical.climate"].settings!.temperature)
    : epochs;
  const ecology = selection["ecology.living"].configuration!;
  return physical.map((epoch, index) => ({
    ...epoch,
    ecology: landscapeEpoch(
      epoch.ecology as EcologyEpoch,
      ecology.landscape as EcologyEpoch | undefined,
      Boolean(ecology.glaciated),
      index,
      epochs.length
    ),
  }));
}

export function replaceDraftEpochs(
  draft: GenerationDraft,
  epochs: Epoch[],
  identities: Record<string, string> = {}
): GenerationDraft {
  const normalized = draft.recipe.features ? draft : normalizeGenerationDraft(draft);
  const parsed = generationEpochSchema.array().min(1).parse(epochs);
  requireThat(
    new Set(parsed.map((epoch) => epoch.id)).size === parsed.length,
    "draft_epoch",
    "Use unique history names."
  );
  const features = rebindDraftEpochs(normalized.recipe.features!, parsed, identities);
  if (!Object.keys(identities).length) {
    features["physical.lifecycle"].configuration!.history = null;
    features["ecology.living"].configuration!.landscape = null;
    features["ecology.living"].configuration!.glaciated = false;
  }
  return {
    ...normalized,
    recipe: {
      ...normalized.recipe,
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
  requireThat(
    epochs.some((epoch) => epoch.id === id),
    "draft_epoch",
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
  requireThat(
    epochs.some((epoch) => epoch.id === id),
    "draft_epoch",
    `Choose an existing epoch: ${id}.`
  );
  return updateFeature(draft, "physical.lifecycle", {
    configuration: {
      history: null,
      epochs: epochs.map((epoch) =>
        physicalEpoch(epoch.id === id ? { ...epoch, ...patch } : epoch)
      ),
    },
  });
}

export function renameDraftEpoch(draft: GenerationDraft, id: string, nextId: string) {
  const target = nextId.trim();
  return changeEpoch(draft, id, (epoch) => ({ ...epoch, id: target }), { [target]: id });
}

export function insertDraftEpoch(draft: GenerationDraft, index: number, id: string) {
  const epochs = draftEpochs(draft);
  requireThat(
    Number.isInteger(index) && index >= 0 && index <= epochs.length,
    "draft_epoch",
    "Choose an insertion position in the shared history."
  );
  epochs.splice(index, 0, generationEpochSchema.parse({ ...defaultEpochs()[0], id }));
  return replaceDraftEpochs(draft, epochs);
}

export function deleteDraftEpoch(draft: GenerationDraft, id: string) {
  const epochs = draftEpochs(draft);
  requireThat(
    epochs.some((epoch) => epoch.id === id),
    "draft_epoch",
    `Choose an existing epoch: ${id}.`
  );
  return replaceDraftEpochs(
    draft,
    epochs.filter((epoch) => epoch.id !== id)
  );
}

export function moveDraftEpoch(draft: GenerationDraft, id: string, index: number) {
  const epochs = draftEpochs(draft),
    previous = epochs.findIndex((epoch) => epoch.id === id);
  requireThat(
    previous >= 0 && Number.isInteger(index) && index >= 0 && index < epochs.length,
    "draft_epoch",
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
  requireThat(
    draftEpochs(draft).some((epoch) => epoch.id === id),
    "draft_epoch",
    `Choose an existing epoch: ${id}.`
  );
  const epochs = Object.fromEntries(
    draftEpochs(draft).map((epoch) => [epoch.id, epoch.ecology ?? {}])
  );
  return updateFeature(draft, "ecology.living", {
    configuration: {
      landscape: null,
      glaciated: false,
      epochs: { ...epochs, [id]: { ...epochs[id], ...patch } },
    },
  });
}

export function updateMagicActivity(
  draft: GenerationDraft,
  id: string,
  system: string,
  value: number
) {
  requireThat(
    draftEpochs(draft).some((epoch) => epoch.id === id),
    "draft_epoch",
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
