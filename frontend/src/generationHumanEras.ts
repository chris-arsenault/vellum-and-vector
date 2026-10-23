import { requireThat, type World, type ParameterValues } from "@atlas/domain";
import { updateFeature, type GenerationDraft } from "./generationDraft";
type HumanEra = NonNullable<World["humanEras"]>[number];
export type OperativeEra = HumanEra;
export function draftHumanEras(draft: GenerationDraft) {
  return draft.recipe.features!["human.cultures"].configuration!.eras as unknown as OperativeEra[];
}
function setEras(draft: GenerationDraft, eras: OperativeEra[]) {
  return updateFeature(draft, "human.cultures", {
    configuration: { eras: eras as unknown as ParameterValues[string] },
  });
}
export function updateHumanEra(
  draft: GenerationDraft,
  index: number,
  fields: Partial<Pick<OperativeEra, "years" | "mobility" | "politicalCapacity" | "physicalEpoch">>
) {
  return setEras(
    draft,
    draftHumanEras(draft).map((era, i) => (i === index ? { ...era, ...fields } : era))
  );
}
export function renameHumanEra(draft: GenerationDraft, index: number, name: string) {
  const eras = draftHumanEras(draft),
    id = name.trim(),
    previous = eras[index].id;
  requireThat(
    id && !eras.some((era, i) => i !== index && era.id === id),
    "draft_era",
    "Use a nonempty, unique era name."
  );
  const next = setEras(
    draft,
    eras.map((era, i) => (i === index ? { ...era, id } : era))
  );
  return {
    ...next,
    recipe: {
      ...next.recipe,
      settings: {
        ...next.recipe.settings,
        humanEras: next.recipe.settings.humanEras.map((era) =>
          era.id === previous ? { ...era, id } : era
        ),
      },
    },
  };
}
export function addHumanEra(draft: GenerationDraft) {
  const eras = draftHumanEras(draft);
  let number = eras.length + 1;
  while (eras.some((era) => era.id === `Era ${number}`)) number++;
  return setEras(draft, [
    ...eras,
    { id: `Era ${number}`, years: 200, mobility: 1, politicalCapacity: 1, physicalEpoch: null },
  ]);
}
export function removeHumanEra(draft: GenerationDraft, index: number) {
  const id = draftHumanEras(draft)[index].id;
  const next = setEras(
    draft,
    draftHumanEras(draft).filter((_, i) => i !== index)
  );
  return {
    ...next,
    recipe: {
      ...next.recipe,
      settings: {
        ...next.recipe.settings,
        humanEras: next.recipe.settings.humanEras.filter((era) => era.id !== id),
      },
    },
  };
}
