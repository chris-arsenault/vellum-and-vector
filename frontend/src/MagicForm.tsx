import { makeCommand, useGenerate } from "./useAtlas";
import { useState } from "react";
import { ErrorMessage } from "./ErrorMessage";
import type { EditorState } from "./useEditor";
import { magicFeatures } from "./magicFeatures";
import { inheritedGeneration } from "./generationJobs";
import { MagicSystemsForm } from "./MagicSystemsForm";

export function MagicForm({ editor }: { editor: EditorState }) {
  const generate = useGenerate(editor.world, editor.area.id);
  const previous = editor.world.generations.filter((run) => run.areaId === editor.area.id).at(-1);
  const [quality, setQuality] = useState(
    previous?.quality ?? inheritedGeneration(editor.world, editor.area.id)?.quality ?? "draft"
  );
  const source = editor.world.magic.find((source) => source.id === editor.magicDraft?.id);
  return (
    <section>
      <h2>Magic in this landscape</h2>
      <MagicSystemsForm editor={editor} />
      <p>Locate a source and its reach, then choose how it changes the environment.</p>
      <button className="primary" onClick={() => editor.setTool("magic")}>
        Draw source & reach
      </button>
      {editor.magicDraft ? (
        <SourceSettings
          key={`${source?.id ?? "new"}:${editor.magicDraft.source.x}:${editor.magicDraft.source.y}`}
          editor={editor}
        />
      ) : (
        <p>
          Click the source position, then click the edge of its influence. Select an existing source
          to edit or move it.
        </p>
      )}
      <SourceList editor={editor} />
      <label>
        Application detail
        <select value={quality} onChange={(event) => setQuality(event.target.value)}>
          <option value="draft">Draft</option>
          <option value="standard">Standard</option>
          <option value="fine">Fine</option>
        </select>
      </label>
      <button
        className="secondary"
        disabled={generate.isPending}
        onClick={() => generate.mutate({ domains: ["magic"], quality, seed: editor.world.seed })}
      >
        Apply magic to geography
      </button>
      <p className="hint">
        Saving changes the source. Apply magic to update climate and water from the current
        geography; generate land and magic together to evolve geological history.
      </p>
      <ErrorMessage error={generate.error} />
    </section>
  );
}
function SourceList({ editor }: { editor: EditorState }) {
  return (
    <section>
      <h3>Located sources</h3>
      {editor.world.magic.map((source) => (
        <div key={source.id}>
          <strong>{source.name}</strong>
          <small>
            {source.effect} · reach {source.radius.toFixed(0)} m
          </small>
          <button
            className="quiet"
            onClick={() => {
              editor.setMagicDraft({ id: source.id, source: source.source, radius: source.radius });
              editor.setTool("select");
            }}
          >
            Edit source
          </button>
          <button
            className="quiet"
            onClick={() => editor.execute("removeMagicSource", { id: source.id })}
          >
            Remove source
          </button>
        </div>
      ))}
    </section>
  );
}
function SourceSettings({ editor }: { editor: EditorState }) {
  const draft = editor.magicDraft!,
    source = editor.world.magic.find((source) => source.id === draft.id);
  const [systemId, setSystemId] = useState(source?.systemId ?? "");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        saveSource(editor, new FormData(event.currentTarget));
      }}
    >
      <h3>{source ? `Edit ${source.name}` : "Configure this source"}</h3>
      <label>
        Source name
        <input name="name" defaultValue={source?.name ?? "Magical source"} required />
      </label>
      <SourceSystem editor={editor} systemId={systemId} change={setSystemId} />
      {!systemId && <SourceEffect effect={source?.effect} />}
      <SourceStrengthAndReach key={systemId} editor={editor} systemId={systemId} />
      <SourceBehavior editor={editor} systemId={systemId} />
      <button className="primary" disabled={editor.commit.isPending}>
        Save magical source
      </button>
      {source && <MoveSource editor={editor} id={source.id} />}
      <button type="button" className="quiet" onClick={() => editor.setMagicDraft(null)}>
        Cancel source editing
      </button>
    </form>
  );
}
function SourceStrengthAndReach({ editor, systemId }: { editor: EditorState; systemId: string }) {
  const draft = editor.magicDraft!,
    source = editor.world.magic.find((source) => source.id === draft.id);
  return (
    <>
      <label>
        Strength
        <input
          name="strength"
          type="number"
          min="0"
          step="any"
          defaultValue={source?.strength ?? (systemId ? 1000 : 25)}
          required
        />
      </label>
      <label>
        Reach · m
        <input
          name="radius"
          type="number"
          min=".01"
          step="any"
          value={draft.radius}
          onChange={(event) =>
            editor.setMagicDraft({ ...draft, radius: Number(event.target.value) })
          }
          required
        />
      </label>
    </>
  );
}
function SourceSystem({
  editor,
  systemId,
  change,
}: {
  editor: EditorState;
  systemId: string;
  change: (systemId: string) => void;
}) {
  return (
    <label>
      Magical system
      <select name="systemId" value={systemId} onChange={(event) => change(event.target.value)}>
        <option value="">Independent local effect</option>
        {(editor.world.magicSystems ?? []).map((system) => (
          <option key={system.id} value={system.id}>
            {system.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function SourceBehavior({ editor, systemId }: { editor: EditorState; systemId: string }) {
  const source = editor.world.magic.find((source) => source.id === editor.magicDraft?.id);
  if (systemId)
    return (
      <>
        <p>
          This core uses its system's propagation, feedback and storage. Strength uses the 0–1,000
          scale. Reach controls radial propagation; fractures and ocean routes follow geography.
        </p>
        <SourceStart editor={editor} />
      </>
    );
  return (
    <>
      <label>
        Propagation
        <select name="propagation" defaultValue={source?.propagation ?? "radial"}>
          <option value="radial">Outward from source</option>
          <option value="fracture">Along fractures</option>
          <option value="cold">Toward cold, retained in ice</option>
          <option value="ocean">Through ocean & bathymetry</option>
          <option value="advect">Carried with crust</option>
        </select>
      </label>
      <MagicHistory editor={editor} />
    </>
  );
}
function MoveSource({ editor, id }: { editor: EditorState; id: string }) {
  return (
    <button
      type="button"
      className="secondary"
      onClick={() => {
        editor.setSelected(
          magicFeatures(editor.world, editor.area.id, editor.area.footprint).find(
            (feature) => feature.id === id
          ) ?? null
        );
        editor.setTool("move");
      }}
    >
      Move source on map
    </button>
  );
}
function SourceEffect({ effect }: { effect?: string }) {
  return (
    <label>
      Environmental effect
      <select name="effect" defaultValue={effect ?? "heat"}>
        <option value="heat">Heating · strength in °C</option>
        <option value="cold">Cooling · strength in °C</option>
        <option value="erosionResistance">Rock hardening · strength / 1,000</option>
        <option value="pressure">Coastal forcing · relative strength</option>
      </select>
    </label>
  );
}
function saveSource(editor: EditorState, form: FormData) {
  const draft = editor.magicDraft!,
    source = editor.world.magic.find((source) => source.id === draft.id);
  editor.commit.mutate(
    makeCommand(editor.world, "putMagicSource", {
      id: source?.id ?? crypto.randomUUID(),
      areaId: source?.areaId ?? editor.area.id,
      name: String(form.get("name")),
      ...(form.get("systemId") ? { systemId: String(form.get("systemId")) } : {}),
      source: draft.source,
      radius: Number(form.get("radius")),
      strength: Number(form.get("strength")),
      ...sourceBehavior(form, source),
    }),
    { onSuccess: () => editor.setMagicDraft(null) }
  );
}
function sourceBehavior(form: FormData, source?: EditorState["world"]["magic"][number]) {
  return {
    effect: String(form.get("effect") ?? source?.effect ?? "heat"),
    propagation: String(form.get("propagation") ?? source?.propagation ?? "radial"),
    decay: Number(form.get("decay")),
    storage: Number(form.get("storage")),
    startsAtEpoch: Number(form.get("startsAtEpoch")),
    dependsOn: form.getAll("dependsOn").map(String),
  };
}
function MagicHistory({ editor }: { editor: EditorState }) {
  const source = editor.world.magic.find((source) => source.id === editor.magicDraft?.id);
  return (
    <details>
      <summary>Persistence through epochs & interactions</summary>
      <label>
        Decay per year
        <input
          name="decay"
          type="number"
          min="0"
          max="1"
          step=".05"
          defaultValue={source?.decay ?? 0.2}
        />
      </label>
      <label>
        Stored effect
        <input
          name="storage"
          type="number"
          min="0"
          step=".05"
          defaultValue={source?.storage ?? 0.3}
        />
      </label>
      <SourceStart editor={editor} />
      <label>
        Depends on these sources
        <select name="dependsOn" multiple defaultValue={source?.dependsOn ?? []}>
          {editor.world.magic
            .filter((other) => other.id !== source?.id)
            .map((other) => (
              <option key={other.id} value={other.id}>
                {other.name}
              </option>
            ))}
        </select>
      </label>
    </details>
  );
}
function SourceStart({ editor }: { editor: EditorState }) {
  const source = editor.world.magic.find((source) => source.id === editor.magicDraft?.id);
  return (
    <label>
      Active from
      <select name="startsAtEpoch" defaultValue={source?.startsAtEpoch ?? 0}>
        {editor.world.epochs.map((epoch, index) => (
          <option key={epoch.id} value={index}>
            {epoch.id}
          </option>
        ))}
      </select>
    </label>
  );
}
