import type { MagicSystem } from "@atlas/domain";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { CartographicDecision } from "./CartographicDecisions";
import { cartographicControls } from "./cartographicDraft";
import { setDraftMagicSystems } from "./generationDraftEpochs";
import { updateFeature } from "./generationDraft";
import { useWorkflowFields } from "./workflowFieldState";

export function GenerationInfluences({ flow }: { flow: GenerationWorkflow }) {
  const systems = flow.draft.recipe.features!["magic.configured"].configuration!
    .magicSystems as unknown as MagicSystem[];
  return (
    <section aria-label="Magical geography">
      {systems.map((system) => (
        <SystemOutcomes key={system.id} flow={flow} system={system} systems={systems} />
      ))}
      <button type="button" onClick={() => flow.setStage("environment")}>
        Return to landscape
      </button>
    </section>
  );
}

function SystemOutcomes({
  flow,
  system,
  systems,
}: {
  flow: GenerationWorkflow;
  system: MagicSystem;
  systems: MagicSystem[];
}) {
  const fields = useWorkflowFields();
  const fixed = Boolean(flow.options.source);
  const controls = cartographicControls().filter((control) => control.system === system.id);
  const available =
    flow.draft.recipe.features!["magic.configured"].enabled &&
    flow.draft.recipe.domains.includes("magic");
  const included = system.enabled && available;
  return (
    <fieldset disabled={fixed}>
      <legend>{system.name}</legend>
      <label className="check">
        <input
          type="checkbox"
          aria-label={`Include ${system.name}`}
          checked={Boolean(included)}
          onChange={(event) => {
            fields.clear(`magic.${system.id}.`);
            const draft = setDraftMagicSystems(
              flow.draft,
              systems.map((item) => ({
                ...item,
                enabled:
                  item.id === system.id ? event.target.checked : Boolean(available && item.enabled),
              }))
            );
            flow.change(
              event.target.checked
                ? updateFeature(draft, "magic.configured", { enabled: true })
                : draft
            );
          }}
        />
        Include {system.name}
      </label>
      {fixed && <p>System inclusion and completed geography are inherited.</p>}
      {included &&
        controls.map((control) => (
          <CartographicDecision key={control.id} flow={flow} control={control} />
        ))}
      {included && !controls.length && (
        <p>
          This system uses its authored recipe. It has no curated geographic decisions registered.
        </p>
      )}
    </fieldset>
  );
}
