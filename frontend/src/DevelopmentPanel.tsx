import { useGenerate } from "./useAtlas";
import { ErrorMessage } from "./ErrorMessage";
import { GenerationControls } from "./GenerationControls";
import {
  defaultAtlasParameters,
  atlasParameterDefinitions,
  type AtlasParameters,
} from "@atlas/generation";
import type { EditorState } from "./useEditor";
import type { World } from "./types";
import { HumanEraForm } from "./HumanEraForm";
import { PhysicalHistoryForm } from "./PhysicalHistoryForm";
import { inheritedGeneration } from "./generationJobs";
import { bounds } from "./presentation";

export function DevelopmentPanel({ world, editor }: { world: World; editor: EditorState }) {
  const generated = world.fields.some((field) => field.areaId === editor.area.id);
  return (
    <section>
      <p className="eyebrow">DEVELOP THIS PLACE</p>
      <h2>{editor.area.name}</h2>
      <p>
        Work from the whole landscape toward the places that matter. Detail inherits the geography
        around it.
      </p>
      {editor.area.profile !== "interior" && (
        <button className="primary" onClick={() => editor.setTool("regionOutline")}>
          Draw a region to develop
        </button>
      )}
      <button
        className="secondary"
        onClick={() =>
          editor.setWorkspace(editor.area.profile === "interior" ? "interior" : "terrain")
        }
      >
        Edit this map by hand
      </button>
      <button className="secondary" onClick={() => editor.setPanel("more")}>
        Use a reusable template
      </button>
      <button className="secondary" onClick={() => editor.setWorkspace("magic")}>
        Configure magical systems
      </button>
      <details open={!generated}>
        <summary>
          {generated ? "Generate or regenerate systems" : "Generate a starting landscape"}
        </summary>
        <GenerationForm world={world} editor={editor} />
      </details>
      <BoundarySummary editor={editor} />
      <details>
        <summary>Configure physical history</summary>
        <PhysicalHistoryForm world={world} editor={editor} />
      </details>
      <GenerationInputs world={world} />
      <details>
        <summary>Configure human history</summary>
        <HumanEraForm world={world} editor={editor} />
      </details>
    </section>
  );
}
function GenerationInputs({ world }: { world: World }) {
  const recent = world.generations.at(-1);
  if (!recent) return null;
  return (
    <details>
      <summary>Last generation settings</summary>
      <p>
        {recent.domains.join(", ")} · {recent.quality} · seed {recent.seed ?? world.seed}
      </p>
      <dl>
        {Object.entries(recent.parameters ?? {}).map(([name, value]) => (
          <div key={name}>
            <dt>{parameterLabels[name] ?? name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
const parameterLabels: Record<string, string> = Object.fromEntries(
  Object.entries(atlasParameterDefinitions).map(([key, definition]) => [
    key,
    `${definition.label} · ${definition.unit}`,
  ])
);
function GenerationForm({ world, editor }: { world: World; editor: EditorState }) {
  const generate = useGenerate(world, editor.area.id);
  const previous = inheritedGeneration(world, editor.area.id);
  const extent = bounds(editor.area.footprint);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        generate.mutate({
          domains: form.getAll("domains").map(String),
          quality: String(form.get("quality")),
          seed: Number(form.get("seed")),
          parameters: Object.fromEntries(
            Object.keys(defaultAtlasParameters).map((key) => [key, Number(form.get(key))])
          ) as AtlasParameters,
        });
      }}
    >
      <DomainChoices profile={editor.area.profile} />
      <GenerationControls
        key={editor.area.id}
        profile={editor.area.profile}
        seed={previous?.seed ?? world.seed}
        initial={previous?.parameters}
        quality={previous?.quality}
        width={extent[2] - extent[0]}
        height={extent[3] - extent[1]}
      />
      <p className="hint">
        Completed world history stays fixed. Regional maps refine inherited geography without
        running new physical or human eras.
      </p>
      <button className="primary" disabled={generate.isPending}>
        {generate.isPending ? "Starting…" : "Generate selected domains"}
      </button>
      <ErrorMessage error={generate.error} />
    </form>
  );
}
export function DomainChoices({ profile }: { profile: string }) {
  const domains =
    profile === "interior" ? ["built"] : ["physical", "magic", "cultural", "political", "built"];
  const labels: Record<string, string> = {
    physical: "Land, climate, water & life",
    magic: "Magical effects",
    cultural: "Communities & distributions",
    political: "Territory & claims",
    built: "Settlements & structures",
  };
  return (
    <fieldset>
      <legend>Develop these systems</legend>
      {domains.map((domain) => (
        <label key={domain} className="check">
          <input
            type="checkbox"
            name="domains"
            value={domain}
            defaultChecked={domain === "physical" || domain === "magic" || domain === "built"}
          />
          {labels[domain]}
        </label>
      ))}
    </fieldset>
  );
}
export function BoundarySummary({ editor }: { editor: EditorState }) {
  const contract = editor.area.boundary;
  return (
    <details className="boundary-summary">
      <summary>Inherited geography</summary>
      <p>
        {contract
          ? `${contract.crossings.length} locked crossings · ${contract.epochs.length} inherited epochs`
          : "World root · no external geographic parent"}
      </p>
      {contract?.crossings.slice(0, 8).map((crossing, index) => (
        <small key={index}>
          {crossing.kind} · {crossing.point.x.toFixed(1)}, {crossing.point.y.toFixed(1)} · flow{" "}
          {crossing.flow.toFixed(1)}
        </small>
      ))}
      {editor.area.traits.map((trait, index) => (
        <small key={index}>
          {trait.kind}: {trait.field} {trait.minimum}–{trait.maximum}
          {trait.cause ? ` · ${trait.cause}` : ""}
        </small>
      ))}
    </details>
  );
}
