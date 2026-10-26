import { controlFeatures, type CartographicControl } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import {
  applyCartographicChoice,
  visibleCartographicControls,
  cartographicValue,
  cartographicFieldPending,
} from "./cartographicDraft";
import { useWorkflowFields } from "./workflowFieldState";
import { discardFeatureFieldEdits } from "./generationFieldEdits";

export function CartographicDecisions({ flow }: { flow: GenerationWorkflow }) {
  const controls = visibleCartographicControls(Boolean(flow.options.source), flow.draft).filter(
    (item) => item.section === flow.stage && !item.system
  );
  return (
    <div className="cartographic-decisions">
      {controls.map((control) => (
        <CartographicDecision key={control.id} flow={flow} control={control} />
      ))}
    </div>
  );
}

export function CartographicDecision({
  flow,
  control,
  adjust = true,
}: {
  flow: GenerationWorkflow;
  control: CartographicControl;
  /** Offer the advanced panel; off where the step already shows the affected settings. */
  adjust?: boolean;
}) {
  const fields = useWorkflowFields();
  const affected = controlFeatures(control);
  const unfinished = cartographicFieldPending(control, fields.errors);
  const value = unfinished ? "custom" : cartographicValue(flow.draft, control);
  const change = (value: string) => {
    for (const field of control.fields ?? []) fields.clearExact(field);
    const choice = control.choices.find((item) => item.id === value)!;
    for (const [id, patch] of Object.entries(choice.features)) {
      if (patch.enabled === false) discardFeatureFieldEdits(flow, id, fields);
      if (patch.settings)
        for (const key of Object.keys(patch.settings))
          fields.clearExact("feature." + id + "." + key);
    }
    flow.change(applyCartographicChoice(flow.draft, control, value));
  };
  return (
    <article className="cartographic-control" id={"intent-" + control.id}>
      <label>
        <strong>{control.label}</strong>
        <select
          aria-label={control.label}
          value={value}
          onChange={(event) => change(event.target.value)}
        >
          <option value="custom" disabled>
            {control.system ? "Authored recipe" : "Custom"}
          </option>
          {control.choices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <p>{control.explanation}</p>
      {!control.system && adjust && (
        <button
          type="button"
          className="setup-link"
          aria-label={"Adjust " + control.label.toLowerCase()}
          onClick={() => flow.locate(affected[0])}
        >
          Adjust
        </button>
      )}
    </article>
  );
}
