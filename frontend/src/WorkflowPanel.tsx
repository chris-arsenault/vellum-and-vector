import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { commitCommand } from "./atlasCommands";
import { startGeneration } from "./generationJobs";
import { ErrorMessage } from "./ErrorMessage";
import { AdvancedPanel } from "./AdvancedPanel";
import { FeatureForm } from "./FeatureForm";
import { areaInput, type EditorState } from "./useEditor";
import { makeCommand, useGenerate } from "./useAtlas";
import { rectangle } from "./presentation";
import { profiles, type World } from "./types";
import { ElevationFields } from "./FormFields";
import { ReconcilePanel } from "./ReconcilePanel";

export function WorkflowPanel({ world, editor }: { world: World; editor: EditorState }) {
  if (editor.panel === "reconcile") return <ReconcilePanel world={world} editor={editor} />;
  if (editor.tool === "sculpt")
    return (
      <section>
        <h2>Field brush</h2>
        <p>{editor.channel} · click the map to apply the signed change.</p>
        <label>
          Radius · m
          <input
            type="number"
            min=".01"
            step="any"
            value={editor.brush.radius}
            onChange={(event) =>
              editor.setBrush({ ...editor.brush, radius: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Change
          <input
            type="number"
            step="any"
            value={editor.brush.delta}
            onChange={(event) =>
              editor.setBrush({ ...editor.brush, delta: Number(event.target.value) })
            }
          />
        </label>
        <button
          className="secondary"
          onClick={() => editor.setBrush({ ...editor.brush, delta: -editor.brush.delta })}
        >
          Reverse direction
        </button>
        <button className="quiet" onClick={() => editor.setTool("select")}>
          Finish sculpting
        </button>
      </section>
    );
  if (editor.panel === "more") return <AdvancedPanel world={world} editor={editor} />;
  if (editor.panel === "refine") return <RefineForm world={world} editor={editor} />;
  if (editor.panel === "feature") return <FeatureForm world={world} editor={editor} />;
  return <GenerateForm world={world} editor={editor} />;
}

function GenerateForm({ world, editor }: { world: World; editor: EditorState }) {
  const generate = useGenerate(world, editor.area.id);
  return (
    <section>
      <p className="eyebrow">{editor.area.profile} GENERATION</p>
      <h2>{editor.area.name}</h2>
      <p className="hint">
        Generate selected systems here. Authored features and contracted crossings are preserved.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          generate.mutate({
            domains: form.getAll("domains").map(String),
            quality: String(form.get("quality")),
            seed: Number(form.get("seed")),
          });
        }}
      >
        <DomainChoices profile={editor.area.profile} />
        <label>
          Quality
          <select name="quality" defaultValue="standard">
            <option value="draft">Draft · 16,384 terrain triangles</option>
            <option value="standard">Standard · 65,536 terrain triangles</option>
            <option value="fine">Fine · 262,144 terrain triangles</option>
          </select>
        </label>
        <label>
          Seed
          <input name="seed" type="number" defaultValue={world.seed} required />
        </label>
        <p className="hint">
          Full physical epochs run at every quality. More detail increases work; stages and
          cancellation remain available.
        </p>
        <BoundarySummary editor={editor} />
        <button className="primary" disabled={generate.isPending}>
          {generate.isPending ? "Starting…" : "Generate selected domains"}
        </button>
        <ErrorMessage error={generate.error} />
      </form>
    </section>
  );
}

function useRefinement(world: World, editor: EditorState) {
  const cache = useQueryClient();
  const create = useMutation({
    mutationFn: async (form: FormData) => {
      const geometry =
        editor.selection ??
        rectangle(
          Number(form.get("x")),
          Number(form.get("y")),
          Number(form.get("width")),
          Number(form.get("height"))
        );
      const input = {
        ...areaInput(editor.area, geometry, form),
        contextFeatureId:
          editor.selected &&
          editor.selection &&
          ["building", "settlement", "community", "cave"].includes(editor.selected.kind)
            ? editor.selected.id
            : null,
      };
      const result = commitCommand(world.id, makeCommand(world, "createArea", input));
      const area = Object.values(result.candidate.areas).find((a) => !world.areas[a.id])!;
      cache.setQueryData(["world", world.id], result.candidate);
      editor.enter(area.id);
      if (input.approach === "procedural")
        startGeneration(world.id, {
          operationId: crypto.randomUUID(),
          expectedVersion: result.candidate.version,
          areaId: area.id,
          domains: input.domains,
          seed: world.seed,
          quality: "standard",
        });
      return result;
    },
    onSuccess: () => {
      editor.setSelection(null);
      editor.setPanel("generate");
      void cache.invalidateQueries({ queryKey: ["jobs", world.id] });
    },
  });
  return create;
}
function RefineForm({ world, editor }: { world: World; editor: EditorState }) {
  const create = useRefinement(world, editor);
  const available = profiles.slice(profiles.indexOf(editor.area.profile) + 1);
  const [profile, setProfile] = useState(
    editor.selected?.kind === "building" && available.includes("interior")
      ? "interior"
      : available[0]
  );
  if (!available.length)
    return (
      <p>
        Interiors can contain rooms and vertical connections. No additional generic creation profile
        is needed.
      </p>
    );
  return (
    <section>
      <p className="eyebrow">CREATE LOCATED DETAIL</p>
      <h2>Refine an area</h2>
      <p className="hint">
        Select an extent on the map, or enter world coordinates below. You may skip creation
        profiles.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(new FormData(event.currentTarget));
        }}
      >
        <label>
          Name
          <input name="name" required placeholder="Name this place" />
        </label>
        <label>
          Creation profile
          <select
            name="profile"
            value={profile}
            onChange={(event) => setProfile(event.target.value as typeof profile)}
          >
            {available.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <RefinementExtent editor={editor} />
        <RefinementContext editor={editor} />
        <ElevationFields
          z={
            typeof editor.selected?.attributes.elevation === "number"
              ? editor.selected.attributes.elevation
              : editor.area.frame.origin.z
          }
        />
        <label>
          Approach
          <select name="approach">
            <option value="manual">Manual</option>
            <option value="procedural">Procedural</option>
            <option value="blank">Intentionally empty</option>
          </select>
        </label>
        <DomainChoices key={profile} profile={profile} />
        <BoundarySummary editor={editor} />
        <button className="primary" disabled={create.isPending}>
          Create mapped area
        </button>
        <ErrorMessage error={create.error} />
      </form>
    </section>
  );
}
function RefinementContext({ editor }: { editor: EditorState }) {
  const contexts: Record<string, string> = {
    building: "structure",
    community: "settlement",
    settlement: "settlement",
    cave: "cave",
  };
  return (
    <label>
      Context
      <select name="context" defaultValue={contexts[editor.selected?.kind ?? ""] ?? "landscape"}>
        <option value="landscape">Landscape</option>
        <option value="settlement">Settlement</option>
        <option value="structure">Structure</option>
        <option value="cave">Cave / underground</option>
      </select>
    </label>
  );
}
function RefinementExtent({ editor }: { editor: EditorState }) {
  return editor.selection ? (
    <div className="callout">
      Geographic selection ready · parent {editor.area.name}
      <button type="button" className="quiet" onClick={() => editor.setSelection(null)}>
        Clear selection
      </button>
    </div>
  ) : (
    <>
      <div className="form-row">
        <label>
          East · m
          <input name="x" type="number" defaultValue={editor.area.frame.origin.x} required />
        </label>
        <label>
          North · m
          <input name="y" type="number" defaultValue={editor.area.frame.origin.y} required />
        </label>
      </div>
      <div className="form-row">
        <label>
          Width · m
          <input name="width" type="number" defaultValue="1000" min="0.01" step="any" required />
        </label>
        <label>
          Height · m
          <input name="height" type="number" defaultValue="1000" min="0.01" step="any" required />
        </label>
      </div>
    </>
  );
}

export function DomainChoices({ profile }: { profile: string }) {
  const domains =
    profile === "interior" ? ["built"] : ["physical", "magic", "cultural", "political", "built"];
  return (
    <fieldset>
      <legend>Generation domains</legend>
      {domains.map((domain) => (
        <label key={domain} className="check">
          <input
            type="checkbox"
            name="domains"
            value={domain}
            defaultChecked={domain === "physical" || domain === "built"}
          />
          {domain}
        </label>
      ))}
    </fieldset>
  );
}
function BoundarySummary({ editor }: { editor: EditorState }) {
  const contract = editor.area.boundary;
  return (
    <details className="boundary-summary">
      <summary>Inherited constraints & boundaries</summary>
      <p>
        {contract
          ? `Contract v${contract.version} · ${contract.crossings.length} locked crossings · ${contract.epochs.length} inherited epochs`
          : "World root · no external geographic parent"}
      </p>
      {contract?.crossings.slice(0, 8).map((c, i) => (
        <small key={`${c.featureId}-${i}`}>
          {c.kind} · {c.point.x.toFixed(1)}, {c.point.y.toFixed(1)} · flow {c.flow.toFixed(1)}
        </small>
      ))}
      {editor.area.traits.map((t, i) => (
        <small key={i}>
          {t.kind}: {t.field} {t.minimum}–{t.maximum}
          {t.cause ? ` · ${t.cause}` : ""}
        </small>
      ))}
    </details>
  );
}
