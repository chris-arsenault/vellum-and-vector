import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { DomainSnapshot } from "@atlas/domain";
import type { GenerationRecipe } from "@atlas/generation";
import { draftPreview, newGenerationDraft, type GenerationDraft } from "./generationDraft";
import { GenerationProcesses } from "./GenerationProcesses";
import { GenerationParameters } from "./GenerationParameters";
import { GenerationHistory } from "./GenerationHistory";
import { GenerationReview } from "./GenerationReview";
import { ErrorMessage } from "./ErrorMessage";
import "./generationWizard.css";

interface WizardProps {
  initial?: GenerationDraft;
  source?: DomainSnapshot;
  areaId?: string;
  onGenerate: (draft: GenerationDraft) => void | Promise<void>;
  onManual?: (draft: GenerationDraft) => void | Promise<void>;
  onCancel?: () => void;
}
const steps = ["World", "Processes", "Parameters", "History and magic", "Review"];
function useWizard(props: WizardProps) {
  const [draft, setDraft] = useState(props.initial ?? newGenerationDraft);
  const [step, setStep] = useState(0);
  const preview = useMemo(() => {
    try {
      return { result: draftPreview(draft, props.source, props.areaId), error: null };
    } catch (error) {
      return { result: null, error };
    }
  }, [draft, props.source, props.areaId]);
  const generate = useMutation({
    mutationFn: async (manual: boolean) => {
      if (manual) await props.onManual?.(draft);
      else await props.onGenerate(draft);
    },
  });
  return { draft, setDraft, step, setStep, preview, generate };
}
type WizardFlow = ReturnType<typeof useWizard>;
export function GenerationWizard(props: WizardProps) {
  const flow = useWizard(props);
  const { step, setStep, preview, generate } = flow;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  return (
    <section className="generation-wizard" aria-label="Generation wizard">
      <ol className="generation-steps" aria-label="Generation steps">
        {steps.map((title, index) => (
          <li key={title} aria-current={index === step ? "step" : undefined}>
            {index + 1}. {title}
          </li>
        ))}
      </ol>
      <h2 ref={heading} tabIndex={-1}>
        {steps[step]}
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (step < 4) setStep(step + 1);
          else generate.mutate(false);
        }}
      >
        <div className="generation-step">
          <WizardStep flow={flow} inherited={Boolean(props.source)} />
        </div>
        <ConfigurationErrors preview={preview} correct={() => setStep(1)} />
        <WizardNavigation flow={flow} options={props} />
        <ErrorMessage error={generate.error} />
      </form>
    </section>
  );
}
function WizardStep({ flow, inherited }: { flow: WizardFlow; inherited: boolean }) {
  const { draft, setDraft, preview } = flow;
  const change = (recipe: GenerationRecipe) => setDraft({ ...draft, recipe });
  const context = { recipe: draft.recipe, change, inherited };
  switch (flow.step) {
    case 0:
      return <WorldStep draft={draft} change={setDraft} inherited={inherited} />;
    case 1:
      return <GenerationProcesses {...context} preview={preview.result} />;
    case 2:
      return <GenerationParameters {...context} />;
    case 3:
      return <GenerationHistory {...context} />;
    default:
      return <GenerationReview recipe={draft.recipe} change={change} preview={preview.result} />;
  }
}
function WizardNavigation({ flow, options }: { flow: WizardFlow; options: WizardProps }) {
  const { step, setStep, preview, generate } = flow;
  const invalid = Boolean(
    preview.error || preview.result?.diagnostics.some((item) => item.severity === "error")
  );
  return (
    <>
      <div className="generation-navigation">
        {step > 0 && (
          <button type="button" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        <button className="primary" disabled={generate.isPending || (step === 4 && invalid)}>
          {step === 4 ? (options.source ? "Generate region" : "Generate world") : "Next"}
        </button>
        <AlternativeActions flow={flow} options={options} />
      </div>
      {step === 0 && options.onManual && (
        <p className="hint">
          Next configures procedural generation. Create world starts an empty world for manual
          editing.
        </p>
      )}
    </>
  );
}
function AlternativeActions({ flow, options }: { flow: WizardFlow; options: WizardProps }) {
  const manual = flow.step === 0 && Boolean(options.onManual);
  return (
    <>
      {manual && (
        <button
          type="button"
          disabled={!flow.draft.name.trim() || flow.generate.isPending}
          onClick={() => flow.generate.mutate(true)}
        >
          Create world
        </button>
      )}
      {options.onCancel && (
        <button type="button" onClick={options.onCancel}>
          Cancel setup
        </button>
      )}
    </>
  );
}
function WorldStep({
  draft,
  change,
  inherited,
}: {
  draft: GenerationDraft;
  change: (draft: GenerationDraft) => void;
  inherited: boolean;
}) {
  return (
    <>
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
      <WorldExtent draft={draft} change={change} inherited={inherited} />
      <label>
        Generation seed
        <input
          name="seed"
          type="number"
          required
          value={draft.recipe.seed}
          onChange={(event) =>
            change({ ...draft, recipe: { ...draft.recipe, seed: Number(event.target.value) } })
          }
        />
      </label>
      <label>
        Detail level
        <select
          value={draft.recipe.quality}
          onChange={(event) =>
            change({
              ...draft,
              recipe: {
                ...draft.recipe,
                quality: event.target.value as GenerationRecipe["quality"],
              },
            })
          }
        >
          <option value="draft">Draft</option>
          <option value="standard">Standard</option>
          <option value="fine">Fine</option>
        </select>
      </label>
      <p className="hint">
        Planar metres · higher detail samples the same world more finely. Every selected historical
        mechanism still runs.
      </p>
    </>
  );
}
function WorldExtent({
  draft,
  change,
  inherited,
}: {
  draft: GenerationDraft;
  change: (draft: GenerationDraft) => void;
  inherited: boolean;
}) {
  return (
    <fieldset disabled={inherited}>
      <legend>Geographic extent</legend>
      <div className="form-row">
        {(["width", "height"] as const).map((key) => (
          <label key={key}>
            {key === "width" ? "Width · km" : "Height · km"}
            <input
              name={key}
              type="number"
              min="1"
              value={draft[key] / 1000}
              onChange={(event) => change({ ...draft, [key]: Number(event.target.value) * 1000 })}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function ConfigurationErrors({
  preview,
  correct,
}: {
  preview: { result: ReturnType<typeof draftPreview> | null; error: unknown };
  correct: () => void;
}) {
  const errors = preview.result?.diagnostics.some((item) => item.severity === "error");
  return (
    <>
      <ErrorMessage error={preview.error} />
      {Boolean(preview.result?.diagnostics.length) && (
        <div role={errors ? "alert" : "status"} className={errors ? "error" : "hint"}>
          <p>{errors ? "Resolve these generation dependencies:" : "Generation notes:"}</p>
          <ul>
            {preview.result!.diagnostics.map((item, i) => (
              <li key={i}>{item.message}</li>
            ))}
          </ul>
          {errors && (
            <button type="button" onClick={correct}>
              Review process choices
            </button>
          )}
        </div>
      )}
    </>
  );
}
