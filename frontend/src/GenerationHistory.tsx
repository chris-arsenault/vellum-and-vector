import type { GenerationRecipe } from "@atlas/generation";
import { HistoryDraftEditor, HumanHistoryDraftEditor } from "./HistoryDraftEditor";
import { MagicSystemsEditor } from "./MagicSystemsForm";

export function GenerationHistory({
  recipe,
  change,
  inherited,
}: {
  recipe: GenerationRecipe;
  change: (recipe: GenerationRecipe) => void;
  inherited: boolean;
}) {
  const settings = recipe.settings;
  return (
    <>
      {inherited && (
        <p className="callout">
          This region inherits the world's completed epochs, human history and magical definitions.
          Its generation refines the present without replaying its biological age.
        </p>
      )}
      <fieldset disabled={inherited}>
        <legend>Physical and ecological history</legend>
        <HistoryDraftEditor
          epochs={settings.epochs}
          systems={settings.magicSystems}
          change={(epochs) => change({ ...recipe, settings: { ...settings, epochs } })}
        />
        <HumanHistoryDraftEditor
          eras={settings.humanEras}
          epochs={settings.epochs}
          change={(humanEras) => change({ ...recipe, settings: { ...settings, humanEras } })}
        />
      </fieldset>
      <fieldset disabled={inherited || !recipe.domains.includes("magic")}>
        <legend>Magical systems</legend>
        <MagicSystemsEditor
          systems={settings.magicSystems}
          change={(magicSystems) => change({ ...recipe, settings: { ...settings, magicSystems } })}
        />
      </fieldset>
      <p className="hint">
        Ecology responds before incision and after glacial reconciliation. Each response uses half
        the epoch duration. Final classification adds no biological age.
      </p>
    </>
  );
}
