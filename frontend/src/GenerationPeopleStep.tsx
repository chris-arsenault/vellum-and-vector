import { controlFeatures, type SetupFeature } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { CartographicDecision } from "./CartographicDecisions";
import { visibleCartographicControls } from "./cartographicDraft";
import { discardFeatureFieldEdits } from "./generationFieldEdits";
import { useWorkflowFields } from "./workflowFieldState";

/**
 * The People & places step: one group per human capability with its inclusion and the
 * outcome choices declared for it, each of which sets the bundle of settings that produces
 * the outcome. Adjust opens the advanced panel on the underlying settings and the era
 * schedule, as the land and landscape steps do.
 */
const peopleFeatures = [
  {
    id: "human.cultures",
    label: "Cultures",
    hint: "Cultural identities with their languages and traditions, spreading from their origins through the human eras.",
  },
  {
    id: "human.politics",
    label: "Political territories",
    hint: "Polities seated in their chief towns, reaching along the ways and falling back when they overreach.",
  },
  {
    id: "built.layout",
    label: "Settlements and routes",
    hint: "Settlements, tracks, roads, shipping lanes and highways as the eras leave them.",
  },
];

export function GenerationPeopleStep({ flow }: { flow: GenerationWorkflow }) {
  const features = flow.setup?.features ?? [];
  return (
    <section aria-label="People and places">
      {peopleFeatures.map((entry) => (
        <PeopleFeature
          key={entry.id}
          flow={flow}
          entry={entry}
          feature={features.find((feature) => feature.id === entry.id)}
        />
      ))}
    </section>
  );
}

function PeopleFeature({
  flow,
  entry,
  feature,
}: {
  flow: GenerationWorkflow;
  entry: (typeof peopleFeatures)[number];
  feature: SetupFeature | undefined;
}) {
  const fields = useWorkflowFields();
  const included = Boolean(feature?.enabled);
  const controls = visibleCartographicControls(Boolean(flow.options.source), flow.draft).filter(
    (control) => !control.system && controlFeatures(control).includes(entry.id)
  );
  return (
    <fieldset>
      <legend>{entry.label}</legend>
      <label className="check">
        <input
          type="checkbox"
          aria-label={entry.label}
          checked={included}
          disabled={feature?.status === "inherited"}
          onChange={(event) => {
            if (!event.target.checked) discardFeatureFieldEdits(flow, entry.id, fields);
            flow.feature(entry.id, { enabled: event.target.checked });
          }}
        />
        Include
      </label>
      <p className="hint">{feature?.reason ?? entry.hint}</p>
      {included &&
        controls.map((control) => (
          <CartographicDecision key={control.id} flow={flow} control={control} />
        ))}
    </fieldset>
  );
}
