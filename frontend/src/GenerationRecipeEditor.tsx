import { useState } from "react";
import { normalizeGenerationRecipe, prepareDraft } from "./generationDraft";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { useWorkflowFields } from "./workflowFieldState";
import { ErrorMessage } from "./ErrorMessage";
import { SetupDisclosure } from "./SetupDisclosure";

export function GenerationRecipeEditor({ flow }: { flow: GenerationWorkflow }) {
  return (
    <SetupDisclosure title="Advanced JSON configuration" className="setup-json">
      <RecipeEditor flow={flow} />
    </SetupDisclosure>
  );
}
function RecipeEditor({ flow }: { flow: GenerationWorkflow }) {
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const fields = useWorkflowFields();
  const current = exportRecipe(flow);
  const text = flow.json.dirty ? flow.json.text : current;
  const apply = () => {
    try {
      const submitted: unknown = JSON.parse(text);
      const recipe = normalizeGenerationRecipe(submitted);
      const next = { ...flow.draft, recipe };
      if (flow.options.source) prepareDraft(next, flow.options.source, flow.options.areaId);
      flow.change(next);
      fields.clear();
      flow.setJson({ text: "", dirty: false });
      setError(null);
      setNotice(compatibilityNotice(submitted, recipe));
    } catch (failure) {
      setError(failure);
    }
  };
  return (
    <div>
      <p className="hint">
        Feature selections own parameters and nested configuration. Compatibility fields are derived
        from those values. Applying updates the draft without starting generation.
      </p>
      <label htmlFor="generation-configuration">Generation configuration</label>
      <textarea
        id="generation-configuration"
        rows={16}
        spellCheck={false}
        value={text}
        onChange={(event) => flow.setJson({ text: event.target.value, dirty: true })}
      />
      {flow.json.dirty && (
        <p role="status">Unapplied JSON edits. Apply or discard them before generating.</p>
      )}
      <div className="setup-inline-actions">
        <button type="button" onClick={apply}>
          Apply configuration
        </button>
        <button
          type="button"
          disabled={!flow.json.dirty}
          onClick={() => {
            flow.setJson({ text: "", dirty: false });
            setError(null);
            setNotice("");
          }}
        >
          Discard JSON edits
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      <ErrorMessage error={error} />
    </div>
  );
}
function exportRecipe(flow: GenerationWorkflow) {
  try {
    return JSON.stringify(normalizeGenerationRecipe(flow.draft.recipe), null, 2);
  } catch {
    return JSON.stringify(flow.draft.recipe, null, 2);
  }
}
function compatibilityNotice(
  submitted: unknown,
  normalized: ReturnType<typeof normalizeGenerationRecipe>
) {
  if (
    !submitted ||
    typeof submitted !== "object" ||
    !("features" in submitted) ||
    !submitted.features
  )
    return "Configuration applied.";
  const changed = (["parameters", "settings", "processes"] as const).filter(
    (key) =>
      key in submitted &&
      JSON.stringify(submitted[key as keyof typeof submitted]) !== JSON.stringify(normalized[key])
  );
  return changed.length
    ? `Configuration applied. Feature-owned values take precedence; compatibility ${changed.join(", ")} were regenerated.`
    : "Configuration applied.";
}
