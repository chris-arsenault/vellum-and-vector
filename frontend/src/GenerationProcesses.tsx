import {
  describeProcess,
  optionalProcesses,
  processEnabled,
  type GenerationRecipe,
} from "@atlas/generation";
import type { draftPreview } from "./generationDraft";
import { sequenceStages } from "../../packages/generation/src/sequence";

const domainLabels: Record<string, string> = {
  physical: "Land, climate and water",
  magic: "Magical effects",
  cultural: "Cultures and communities",
  political: "Polities and claims",
  built: "Settlements and structures",
};
export function GenerationProcesses({
  recipe,
  change,
  preview,
  inherited,
}: {
  recipe: GenerationRecipe;
  change: (recipe: GenerationRecipe) => void;
  preview: ReturnType<typeof draftPreview> | null;
  inherited: boolean;
}) {
  const contracts = requiredContracts(preview);
  return (
    <>
      <DraftDomains recipe={recipe} change={change} />
      <fieldset disabled={!recipe.domains.includes("physical")}>
        <legend>Optional physical processes</legend>
        <p className="hint">
          These switches change generation, independently of map layer visibility. Climate,
          drainage, ice balance and validation remain support processes.
        </p>
        {Object.entries(optionalProcesses)
          .filter(([, option]) => !inherited || option.group !== "Geology")
          .map(([id, option]) => (
            <div className="generation-choice" key={id}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={processEnabled(recipe.processes, id)}
                  onChange={(event) =>
                    change({
                      ...recipe,
                      processes: { ...recipe.processes, [id]: event.target.checked },
                    })
                  }
                />
                {option.label}
              </label>
              <p className="hint">{option.help}</p>
            </div>
          ))}
        <button
          type="button"
          onClick={() =>
            change({
              ...recipe,
              processes: {
                ...recipe.processes,
                "canonry.glacial-erosion": false,
                "canonry.glacial-deposition": false,
              },
            })
          }
        >
          Disable glacial sculpting together
        </button>
      </fieldset>
      <details>
        <summary>Required support processes · {contracts.length}</summary>
        <ul>
          {contracts.map((contract) => (
            <li key={contract.id}>
              <strong>{describeProcess(contract).label}</strong> · {describeProcess(contract).role}
              <p className="hint">{describeProcess(contract).help}</p>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}
function requiredContracts(preview: ReturnType<typeof draftPreview> | null) {
  if (!preview) return [];
  const active = new Set(
    sequenceStages(preview.input.configuration!.sequence).map((stage) => stage.invocation?.process)
  );
  return preview.registry
    .contracts()
    .filter((contract) => active.has(contract.id) && !describeProcess(contract).selectable);
}
function DraftDomains({
  recipe,
  change,
}: {
  recipe: GenerationRecipe;
  change: (recipe: GenerationRecipe) => void;
}) {
  return (
    <fieldset>
      <legend>Generation domains</legend>
      {Object.entries(domainLabels).map(([id, label]) => (
        <label className="check" key={id}>
          <input
            type="checkbox"
            checked={recipe.domains.includes(id as GenerationRecipe["domains"][number])}
            onChange={(event) =>
              change({
                ...recipe,
                domains: event.target.checked
                  ? [...recipe.domains, id as GenerationRecipe["domains"][number]]
                  : recipe.domains.filter((domain) => domain !== id),
              })
            }
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
