import type { GenerationRecipe } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { NumberField } from "./WorkflowFields";
import { GenerationResolution } from "./GenerationResolution";
import { setFeatureSetting } from "./generationDraft";
import { mapBoundaryValue } from "@atlas/generation";

export function GenerationWorldStep({ flow }: { flow: GenerationWorkflow }) {
  const { draft, change } = flow;
  const inherited = Boolean(flow.options.source);
  const profile = flow.options.source?.world.areas[flow.options.areaId!]?.profile ?? "world";
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
        <GenerationResolution
          width={draft.width}
          height={draft.height}
          profile={profile}
          disabled={flow.approach === "blank"}
          quality={draft.recipe.quality}
          change={(quality) =>
            change({
              ...draft,
              recipe: {
                ...draft.recipe,
                quality: quality as GenerationRecipe["quality"],
              },
            })
          }
        />
        <BoundaryChoice flow={flow} />
        <NumberField
          label="Generation seed"
          fieldKey="world.seed"
          value={draft.recipe.seed}
          step={1}
          change={(seed) => change({ ...draft, recipe: { ...draft.recipe, seed } })}
        />
      </div>
      <p className="hint">
        Cylinder joins the east and west edges. Pole-to-pole coverage closes the polar caps. Nothing
        leaves all edges open. Ocean surrounded is deferred.
      </p>
      {flow.approach === "procedural" && (
        <p className="brief-next">
          Choose land, landscape, magic and human geography, or review the current defaults.
        </p>
      )}
    </>
  );
}
function BoundaryChoice({ flow }: { flow: GenerationWorkflow }) {
  const { draft, change } = flow,
    source = flow.options.source;
  const value = source
    ? mapBoundaryValue(source.world.reference.boundaryMode)
    : Number(
        draft.recipe.features?.["physical.foundation"]?.settings?.mapBoundary ??
          draft.recipe.parameters.mapBoundary
      );
  return (
    <label>
      Map boundary
      <select
        aria-label="Map boundary"
        disabled={Boolean(source)}
        value={value}
        onChange={(event) =>
          change(
            setFeatureSetting(
              draft,
              "physical.foundation",
              "mapBoundary",
              Number(event.target.value)
            )
          )
        }
      >
        <option value={1}>Cylinder</option>
        <option value={2} disabled>
          Ocean surrounded (coming later)
        </option>
        <option value={0}>Nothing</option>
      </select>
    </label>
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
