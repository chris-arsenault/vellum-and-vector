import type { MagicSystem } from "@atlas/domain";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { CartographicDecision } from "./CartographicDecisions";
import { cartographicControls } from "./cartographicDraft";
import { setDraftMagicSystems } from "./generationDraftEpochs";
import { useWorkflowFields } from "./workflowFieldState";

const activityChoices = [
  { id: "lower", label: "Lower activity", strength: 0.4 },
  { id: "ordinary", label: "Ordinary activity", strength: 1 },
  { id: "higher", label: "Higher activity", strength: 2 },
];

export function GenerationInfluences({ flow }: { flow: GenerationWorkflow }) {
  const definition = cartographicControls().find(
    (control) => control.id === "configured-influences"
  )!;
  const feature = flow.draft.recipe.features!["magic.configured"];
  const systems = feature.configuration!.magicSystems as unknown as MagicSystem[];
  return (
    <section aria-label="Configured influences">
      <CartographicDecision flow={flow} control={definition} />
      {feature.enabled && flow.draft.recipe.domains.includes("magic") && (
        <>
          <p className="hint">
            Source activity scales each configured system. Distribution, effects and independent
            interaction rules keep their configured values.
          </p>
          {systems.map((system) => (
            <SourceActivity key={system.id} flow={flow} system={system} systems={systems} />
          ))}
        </>
      )}
      <div className="setup-inline-actions">
        <button type="button" onClick={() => flow.locate("magic.configured")}>
          Edit sources, effects and rules
        </button>
        <button type="button" onClick={() => flow.setStage("environment")}>
          Return to landscape
        </button>
      </div>
    </section>
  );
}

function SourceActivity({
  flow,
  system,
  systems,
}: {
  flow: GenerationWorkflow;
  system: MagicSystem;
  systems: MagicSystem[];
}) {
  const fields = useWorkflowFields();
  const choice = activityChoices.find((item) => item.strength === system.strength);
  const fixed = Boolean(flow.options.source);
  const pending = Boolean(fields.errors["magic." + system.id + ".strength"]);
  const value = system.enabled ? (pending ? "custom" : (choice?.id ?? "custom")) : "inactive";
  const change = (id: string) => {
    const selected = activityChoices.find((item) => item.id === id);
    fields.clearExact("magic." + system.id + ".strength");
    flow.change(
      setDraftMagicSystems(
        flow.draft,
        systems.map((item) =>
          item.id === system.id
            ? {
                ...item,
                enabled: id !== "inactive",
                ...(selected ? { strength: selected.strength } : {}),
              }
            : item
        )
      )
    );
  };
  return (
    <div className="cartographic-control influence-activity">
      <label>
        <strong>{system.name}</strong>
        <select
          aria-label={system.name + " source activity"}
          value={value}
          disabled={fixed}
          onChange={(event) => change(event.target.value)}
        >
          <option value="custom" disabled>
            Custom
          </option>
          <option value="inactive">Inactive source</option>
          {activityChoices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {fixed && <p>Source definitions and completed activity are inherited.</p>}
    </div>
  );
}
