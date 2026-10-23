import type { GenerationRecipe } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { NumberField } from "./WorkflowFields";

export function GenerationWorldStep({ flow }: { flow: GenerationWorkflow }) {
  const { draft, change } = flow;
  const inherited = Boolean(flow.options.source);
  return (
    <>
      {flow.options.onManual && <StartingApproach flow={flow} />}
      <div className="setup-world-grid">
        <label>
          {inherited ? "Mapped area" : "World name"}
          <input
            name="name"
            required
            value={draft.name}
            readOnly={inherited}
            onChange={(event) => change({ ...draft, name: event.target.value })}
          />
        </label>
        {(["width", "height"] as const).map((key) => (
          <NumberField
            key={key}
            label={key === "width" ? "Width" : "Height"}
            unit="km"
            fieldKey={"world." + key}
            value={draft[key] / 1000}
            min={Number.MIN_VALUE}
            step="any"
            readOnly={inherited}
            change={(value) => change({ ...draft, [key]: value * 1000 })}
          />
        ))}
        <label>
          Detail level
          <select
            name="quality"
            disabled={flow.approach === "blank"}
            value={draft.recipe.quality}
            onChange={(event) =>
              change({
                ...draft,
                recipe: {
                  ...draft.recipe,
                  quality: event.target.value as GenerationRecipe["quality"],
                },
              })
            }
          >
            {["draft", "standard", "fine"].map((quality) => (
              <option key={quality} value={quality}>
                {quality[0].toUpperCase() + quality.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="Generation seed"
          fieldKey="world.seed"
          value={draft.recipe.seed}
          step={1}
          change={(seed) => change({ ...draft, recipe: { ...draft.recipe, seed } })}
        />
      </div>
      <p className="hint">
        Planar metres. Detail controls spatial sampling, separately from the geography you choose
        next.
      </p>
      {flow.approach === "procedural" && (
        <p className="brief-next">
          Choose land, landscape, magic and human geography, or review the current defaults.
        </p>
      )}
    </>
  );
}
function StartingApproach({ flow }: { flow: GenerationWorkflow }) {
  return (
    <fieldset className="setup-approach">
      <legend>Starting approach</legend>
      {(["procedural", "blank"] as const).map((approach) => (
        <label key={approach}>
          <input
            type="radio"
            name="approach"
            checked={flow.approach === approach}
            onChange={() => flow.setApproach(approach)}
          />
          {approach === "procedural" ? "Procedural world" : "Blank world"}
        </label>
      ))}
    </fieldset>
  );
}
