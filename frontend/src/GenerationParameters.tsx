import {
  atlasParameterDefinitions,
  atlasPresets,
  defaultAtlasParameters,
  parameterInactiveReason,
  type AtlasParameterDefinition,
  type AtlasParameters,
  type GenerationRecipe,
} from "@atlas/generation";

export function GenerationParameters({
  recipe,
  inherited,
  change,
}: {
  recipe: GenerationRecipe;
  inherited: boolean;
  change: (recipe: GenerationRecipe) => void;
}) {
  return (
    <>
      {!inherited && <ParameterPreset recipe={recipe} change={change} />}
      {(["geology", "climate", "water", "ecology", "human"] as const).map((group) => (
        <fieldset key={group} disabled={inherited && group === "geology"}>
          <legend>
            {group === "human" ? "People" : group.charAt(0).toUpperCase() + group.slice(1)}
          </legend>
          {inherited && group === "geology" && (
            <p>Geological construction is inherited from the world.</p>
          )}
          {Object.entries(atlasParameterDefinitions)
            .filter(([, definition]) => definition.group === group)
            .map(([key, value]) => {
              const definition: AtlasParameterDefinition = value;
              const reason = parameterInactiveReason(
                key as keyof AtlasParameters,
                recipe.domains,
                recipe.processes,
                inherited
              );
              return (
                <div key={key}>
                  <label>
                    {definition.label} · {definition.unit}
                    <input
                      aria-describedby={reason ? `parameter-${key}-reason` : undefined}
                      disabled={Boolean(reason)}
                      type="number"
                      min={definition.exclusiveMinimum ? definition.step : definition.minimum}
                      max={definition.maximum}
                      step={definition.step}
                      value={recipe.parameters[key as keyof AtlasParameters]}
                      onChange={(event) =>
                        change({
                          ...recipe,
                          parameters: { ...recipe.parameters, [key]: Number(event.target.value) },
                        })
                      }
                    />
                  </label>
                  <small>
                    Default: {definition.default} {definition.unit}
                  </small>
                  {reason && <small id={`parameter-${key}-reason`}>{reason}</small>}
                </div>
              );
            })}
        </fieldset>
      ))}
      <p className="hint">
        Profile rainfall adjusts background terms; epoch rainfall scales the resulting
        precipitation. Vegetation productivity multiplies epoch productivity. Land fraction is
        starting crust, not guaranteed final land coverage.
      </p>
    </>
  );
}
function ParameterPreset({
  recipe,
  change,
}: {
  recipe: GenerationRecipe;
  change: (recipe: GenerationRecipe) => void;
}) {
  return (
    <label>
      Landscape starting point
      <select
        defaultValue="custom"
        onChange={(event) =>
          change({
            ...recipe,
            parameters: {
              ...defaultAtlasParameters,
              ...atlasPresets[event.target.value].parameters,
            },
          })
        }
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
    </label>
  );
}
