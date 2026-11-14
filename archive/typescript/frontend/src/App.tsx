import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ErrorMessage } from "./ErrorMessage";
import { registerWorkspaceWorld } from "./atlasWorkspace";
import { startGeneration } from "./generationJobs";
import { GenerationWizard } from "./GenerationWizard";
import { draftPreview, draftWorldSnapshot, type GenerationDraft } from "./generationDraft";
import { useWorld, useWorlds } from "./useAtlas";
import { Editor } from "./Editor";
import { TemplateStudio } from "./TemplateStudio";
import { LoreEncyclopedia } from "./LoreEncyclopedia";
import { MapStorage } from "./MapStorage";

export function App() {
  return <Atlas />;
}

function Atlas() {
  const worlds = useWorlds();
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [library, setLibrary] = useState(false);
  const [lore, setLore] = useState(false);
  const [opened, setOpened] = useState(0);
  const openSaved = (id: string) => {
    setSelected(id);
    setCreating(false);
    setOpened((value) => value + 1);
  };
  const selectedId = selected || firstWorld(worlds.data);
  const world = useWorld(selectedId);
  if (lore) return <LoreEncyclopedia onClose={() => setLore(false)} />;
  if (loadingAtlas(worlds.isPending, world.isPending, selectedId, creating))
    return <LoadingAtlas />;
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
        key={`${world.data.id}:${opened}`}
        world={world.data}
        worlds={worlds.data ?? []}
        changeWorld={setSelected}
        newWorld={() => setCreating(true)}
        openLore={() => setLore(true)}
        openSaved={openSaved}
      />
    );
  return (
    <main className="setup-page">
      <header className="setup-page-header">
        <div>
          <Brand />
          <h1>New world</h1>
        </div>
        <p className="hint">
          Save maps in this browser to reopen them after reloading. Unsaved changes stay in this
          tab.
        </p>
        <MapStorage onOpen={openSaved} />
        <button className="secondary" onClick={() => setLibrary(true)}>
          Independent template library
        </button>
        <button className="secondary" onClick={() => setLore(true)}>
          Magic lore bible
        </button>
      </header>
      <CreateWorld
        onCancel={world.data ? () => setCreating(false) : undefined}
        onCreate={(id) => {
          setSelected(id);
          setCreating(false);
        }}
      />
      <ErrorMessage error={worlds.error ?? world.error} />
    </main>
  );
}

function LoadingAtlas() {
  return (
    <main className="welcome">
      <div className="welcome-card">
        <Brand />
        <p>Loading atlas…</p>
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

function CreateWorld({
  onCreate,
  onCancel,
}: {
  onCreate: (id: string) => void;
  onCancel?: () => void;
}) {
  const cache = useQueryClient();
  const create = useMutation({
    mutationFn: async ({
      draft,
      generate,
      prepared,
    }: {
      draft: GenerationDraft;
      generate: boolean;
      prepared?: ReturnType<typeof draftPreview>;
    }) => {
      const reviewed = generate ? (prepared ?? draftPreview(draft)) : undefined;
      if (reviewed?.diagnostics.some((item) => item.severity === "error"))
        throw new Error(reviewed.diagnostics.map((item) => item.message).join("\n"));
      const world = await registerWorkspaceWorld(reviewed?.source ?? draftWorldSnapshot(draft));
      if (reviewed)
        await startGeneration(world.id, {
          ...reviewed.input,
          operationId: crypto.randomUUID(),
          expectedVersion: world.version,
        });
      return world;
    },
    onSuccess: (world) => {
      void cache.invalidateQueries({ queryKey: ["worlds"] });
      cache.setQueryData(["world", world.id], world);
      onCreate(world.id);
    },
  });
  return (
    <GenerationWizard
      onCancel={onCancel}
      onGenerate={async (draft, prepared) => {
        await create.mutateAsync({ draft, prepared, generate: true });
      }}
      onManual={async (draft) => {
        await create.mutateAsync({ draft, generate: false });
      }}
    />
  );
}

export function Brand() {
  const build = import.meta.env.VITE_BUILD_SHA ?? "development";
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
      <small
        className="build-version"
        aria-label="Application build"
        title={`Application build ${build}`}
      >
        Build {build.slice(0, 7)}
      </small>
    </div>
  );
}
