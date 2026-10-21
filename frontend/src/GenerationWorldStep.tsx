import { useState, type ReactNode } from "react";
import { atlasPresets, type GenerationRecipe } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { NumberField } from "./WorkflowFields";
import { useWorkflowFields } from "./workflowFieldState";
import {
  applyLandscapeStartingPoint,
  startingPointFields,
  startingPointMatches,
} from "./generationStartingPoint";

export function GenerationWorldStep({
  flow,
  children,
}: {
  flow: GenerationWorkflow;
  children?: ReactNode;
}) {
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
            fieldKey={`world.${key}`}
            value={draft[key] / 1000}
            min={Number.MIN_VALUE}
            step="any"
            readOnly={inherited}
            change={(value) => change({ ...draft, [key]: value * 1000 })}
          />
        ))}
        <NumberField
          label="Generation seed"
          fieldKey="world.seed"
          value={draft.recipe.seed}
          step={1}
          change={(seed) => change({ ...draft, recipe: { ...draft.recipe, seed } })}
        />
        <DetailLevel flow={flow} />
        {!inherited && flow.approach === "procedural" && <StartingPoint flow={flow} />}
      </div>
      <p className="hint">Planar metres. Higher detail samples the same geography more finely.</p>
      {children}
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
            value={approach}
            checked={flow.approach === approach}
            onChange={() => flow.setApproach(approach)}
          />
          {approach === "procedural" ? "Procedural world" : "Blank world"}
        </label>
      ))}
    </fieldset>
  );
}

function DetailLevel({ flow }: { flow: GenerationWorkflow }) {
  const world = !flow.options.source || flow.setup?.context.profile === "world";
  const options = world
    ? [
        "about 16,000 terrain samples",
        "about 65,000 terrain samples",
        "about 262,000 terrain samples",
      ]
    : ["coarse adaptive sampling", "medium adaptive sampling", "dense adaptive sampling"];
  return (
    <label>
      Detail level
      <select
        name="quality"
        disabled={flow.approach === "blank"}
        value={flow.draft.recipe.quality}
        onChange={(event) =>
          flow.change({
            ...flow.draft,
            recipe: {
              ...flow.draft.recipe,
              quality: event.target.value as GenerationRecipe["quality"],
            },
          })
        }
      >
        {(["draft", "standard", "fine"] as const).map((quality) => (
          <option key={quality} value={quality}>
            {quality[0].toUpperCase() + quality.slice(1)}
          </option>
        ))}
      </select>
      <small className="hint">
        {options[(["draft", "standard", "fine"] as const).indexOf(flow.draft.recipe.quality)]}
      </small>
      {world && <small className="hint">Counts include the surrounding simulation margin.</small>}
    </label>
  );
}

function StartingPoint({ flow }: { flow: GenerationWorkflow }) {
  const [selected, setSelected] = useState("balanced");
  const { clear, errors } = useWorkflowFields();
  const invalid = startingPointFields(selected).some((key) => Object.hasOwn(errors, key));
  const value = !invalid && startingPointMatches(flow.draft, selected) ? selected : "custom";
  return (
    <label>
      Landscape starting point
      <select
        name="landscape-start"
        value={value}
        onChange={(event) => {
          const id = event.target.value;
          const next = applyLandscapeStartingPoint(flow.draft, id);
          for (const key of next.fields) clear(key);
          setSelected(id);
          flow.change(next.draft);
        }}
      >
        <option value="custom" disabled>
          Custom settings
        </option>
        {Object.entries(atlasPresets).map(([id, preset]) => (
          <option key={id} value={id}>
            {preset.label}
          </option>
        ))}
      </select>
      <small className="hint">
        Starting points change their listed land or climate controls; other choices stay as
        configured.
      </small>
    </label>
  );
}
