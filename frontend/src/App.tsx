import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ErrorMessage } from "./ErrorMessage";
import { createWorld } from "./atlasState";
import { useWorld, useWorlds } from "./useAtlas";
import { Editor } from "./Editor";
import { TemplateStudio } from "./TemplateStudio";

export function App() {
  return <Atlas />;
}

function Atlas() {
  const worlds = useWorlds();
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [library, setLibrary] = useState(false);
  const selectedId = selected || firstWorld(worlds.data);
  const world = useWorld(selectedId);
  if (loadingAtlas(worlds.isPending, world.isPending, selectedId, creating))
    return (
      <main className="welcome">
        <div className="welcome-card">
          <Brand />
          <p>Loading atlas…</p>
        </div>
      </main>
    );
  if (library)
    return (
      <main className="welcome">
        <div className="welcome-card">
          <Brand />
          <button className="quiet" onClick={() => setLibrary(false)}>
            Return to atlas
          </button>
          <TemplateStudio />
        </div>
      </main>
    );
  if (world.data && !creating)
    return (
      <Editor
        key={world.data.id}
        world={world.data}
        worlds={worlds.data ?? []}
        changeWorld={setSelected}
        newWorld={() => setCreating(true)}
      />
    );
  return (
    <main className="welcome">
      <div className="welcome-card">
        <Brand />
        <p className="eyebrow">A geographically connected world</p>
        <h1>Create your world.</h1>
        <p>Start with its geography. Develop regions, places and interiors as you need them.</p>
        <p className="callout">
          This session lives in this tab. Reloading or closing it discards your worlds.
        </p>
        <CreateWorld
          onCreate={(id) => {
            setSelected(id);
            setCreating(false);
          }}
        />
        <button className="secondary" onClick={() => setLibrary(true)}>
          Independent template library
        </button>
        {creating && (
          <button className="quiet" onClick={() => setCreating(false)}>
            Return to atlas
          </button>
        )}
        <ErrorMessage error={worlds.error ?? world.error} />
      </div>
      <div className="welcome-grid" aria-hidden="true">
        <div className="welcome-circle" />
        <span>WORLD · REGION · LOCAL · SITE · INTERIOR</span>
      </div>
    </main>
  );
}

function firstWorld(worlds: { id: string }[] | undefined) {
  return worlds?.[0]?.id ?? "";
}
function loadingAtlas(
  worldsPending: boolean,
  worldPending: boolean,
  selected: string,
  creating: boolean
) {
  return worldsPending || (!!selected && worldPending && !creating);
}

function CreateWorld({ onCreate }: { onCreate: (id: string) => void }) {
  const cache = useQueryClient();
  const create = useMutation({
    mutationFn: (form: FormData) =>
      Promise.resolve(
        createWorld({
          name: String(form.get("name")),
          seed: Number(form.get("seed")),
          width: Number(form.get("width")) * 1000,
          height: Number(form.get("height")) * 1000,
        })
      ),
    onSuccess: (world) => {
      void cache.invalidateQueries({ queryKey: ["worlds"] });
      cache.setQueryData(["world", world.id], world);
      onCreate(world.id);
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(new FormData(event.currentTarget));
      }}
    >
      <label>
        World name
        <input name="name" placeholder="Name your world" required maxLength={100} />
      </label>
      <div className="form-row">
        <label>
          Width · km
          <input name="width" type="number" min="1" defaultValue="4000" required />
        </label>
        <label>
          Height · km
          <input name="height" type="number" min="1" defaultValue="3000" required />
        </label>
      </div>
      <label>
        Generation seed
        <input name="seed" type="number" defaultValue="104729" required />
      </label>
      <p className="hint">
        Planar world · east / north / up · metric coordinates · sea-level vertical datum
      </p>
      <button className="primary" disabled={create.isPending}>
        {create.isPending ? "Creating…" : "Create world"}
      </button>
      <ErrorMessage error={create.error} />
    </form>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M16 2 20 12 30 16 20 20 16 30 12 20 2 16 12 12Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M16 7 18 14 25 16 18 18 16 25 14 18 7 16 14 14Z" fill="currentColor" />
      </svg>
      <span>
        Vellum <i>&</i> Vector
      </span>
    </div>
  );
}
