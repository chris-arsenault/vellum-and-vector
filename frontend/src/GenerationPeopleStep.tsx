import { controlFeatures, type SetupFeature } from "@atlas/generation";
import type { GenerationWorkflow } from "./useGenerationWorkflow";
import { CartographicDecision } from "./CartographicDecisions";
import { visibleCartographicControls } from "./cartographicDraft";
import { GenerationCultureConfiguration } from "./GenerationCultureConfiguration";
import { SettingControl } from "./GenerationTuning";
import { featureControlSettings } from "./generationWorkflowPresentation";
import { discardFeatureFieldEdits } from "./generationFieldEdits";
import { useWorkflowFields } from "./workflowFieldState";

/**
 * The People & places step: one group per human capability with its inclusion, its
 * curated pattern and the settings the generator reads, then the era schedule the
 * cultural and political histories run on. The advanced panel shows the same fields for
 * one capability at a time; while it does, this step hides its own copy of them.
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
  const find = (id: string) => features.find((feature) => feature.id === id);
  const history = ["human.cultures", "human.politics"].some((id) => find(id)?.enabled);
  const cultures = find("human.cultures");
  return (
    <section aria-label="People and places">
      {peopleFeatures.map((entry) => (
        <PeopleFeature key={entry.id} flow={flow} entry={entry} feature={find(entry.id)} />
      ))}
      {history && cultures && flow.tuning !== "human.cultures" && (
        <GenerationCultureConfiguration flow={flow} feature={cultures} />
      )}
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
  const adjusting = flow.tuning === entry.id;
  const controls = visibleCartographicControls(Boolean(flow.options.source), flow.draft).filter(
    (control) => !control.system && controlFeatures(control).includes(entry.id)
  );
  const settings = featureControlSettings(flow, entry.id);
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
      {included && adjusting && (
        <p className="hint">Being adjusted in the advanced settings below.</p>
      )}
      {included && !adjusting && (
        <>
          {controls.map((control) => (
            <CartographicDecision key={control.id} flow={flow} control={control} adjust={false} />
          ))}
          {settings.length > 0 && (
            <div className="setup-setting-grid">
              {settings.map((setting) => (
                <SettingControl
                  key={setting.owner + "." + setting.key}
                  flow={flow}
                  setting={setting}
                />
              ))}
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
