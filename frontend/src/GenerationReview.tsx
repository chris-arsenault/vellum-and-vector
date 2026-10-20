import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  generationRecipeSchema,
  describeProcess,
  atlasParameterDefinitions,
  type AtlasParameters,
  type GenerationRecipe,
} from "@atlas/generation";
import { sequenceStages, type SequenceStage } from "../../packages/generation/src/sequence";
import type { draftPreview } from "./generationDraft";
import { ErrorMessage } from "./ErrorMessage";

export function GenerationReview({
  preview,
  recipe,
  change,
}: {
  preview: ReturnType<typeof draftPreview> | null;
  recipe: GenerationRecipe;
  change: (recipe: GenerationRecipe) => void;
}) {
  const stages = preview
    ? sequenceStages(preview.input.configuration!.sequence).filter((stage) => stage.invocation)
    : [];
  const phases = causalGroups(stages);
  return (
    <>
      <p>
        {recipe.quality} detail · seed {recipe.seed} · {recipe.domains.join(", ")}
      </p>
      <p>
        {recipe.settings.epochs.length} physical epochs · {stages.length} process invocations.
        Required refreshes remain in causal order.
      </p>
      {phases.map((phase, index) => (
        <details key={index}>
          <summary>{phase.label}</summary>
          <ol className="generation-stage-list">
            {phase.stages.map((stage, i) => {
              const contract = preview!.registry.get(
                stage.invocation!.process,
                stage.invocation!.version
              ).contract;
              return (
                <li key={i}>
                  {describeProcess(contract).label}{" "}
                  <small>· {describeProcess(contract).role}</small>
                </li>
              );
            })}
          </ol>
        </details>
      ))}
      <EffectiveParameters recipe={recipe} />
      <RecipeEditor recipe={recipe} change={change} />
    </>
  );
}
function EffectiveParameters({ recipe }: { recipe: GenerationRecipe }) {
  return (
    <details>
      <summary>Effective creator parameters</summary>
      <dl>
        {Object.entries(recipe.parameters).map(([key, value]) => {
          const definition = atlasParameterDefinitions[key as keyof AtlasParameters];
          return (
            <div key={key}>
              <dt>{definition.label}</dt>
              <dd>
                {value} {definition.unit} ·{" "}
                {value === definition.default ? "Profile default" : "Configured value"}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="hint">
        Inactive settings are retained in the configuration for inspection. Only enabled processes
        consume them.
      </p>
    </details>
  );
}
function causalGroups(stages: SequenceStage[]) {
  const groups: { label: string; stages: SequenceStage[] }[] = [];
  let encounteredEpoch = false;
  for (const stage of stages) {
    if (stage.epochs.length) encounteredEpoch = true;
    const label =
      stage.epochs[0]?.id ?? (encounteredEpoch ? "Present and publication" : "Initial formation");
    if (groups.at(-1)?.label === label) groups.at(-1)!.stages.push(stage);
    else groups.push({ label, stages: [stage] });
  }
  return groups;
}
function RecipeEditor({
  recipe,
  change,
}: {
  recipe: GenerationRecipe;
  change: (recipe: GenerationRecipe) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(recipe, null, 2));
  const apply = useMutation({
    mutationFn: async () => {
      const parsed = generationRecipeSchema.parse(JSON.parse(text));
      change(parsed);
    },
  });
  return (
    <details>
      <summary>Advanced JSON configuration</summary>
      <p>
        Versioned parameters and process choices for this run. Applying JSON updates the draft; it
        does not start generation.
      </p>
      <label htmlFor="generation-configuration">Generation configuration</label>
      <textarea
        id="generation-configuration"
        rows={16}
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="button" onClick={() => apply.mutate()}>
        Apply configuration
      </button>
      <ErrorMessage error={apply.error} />
    </details>
  );
}
