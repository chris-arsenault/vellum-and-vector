import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ErrorMessage } from "./ErrorMessage";
import { registerWorldSnapshot, session } from "./atlasState";
import { startGeneration } from "./generationJobs";
import { GenerationWizard } from "./GenerationWizard";
import { draftPreview, draftWorldSnapshot, type GenerationDraft } from "./generationDraft";
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
    <main className="setup-page">
      <header className="setup-page-header">
        <div>
          <Brand />
          <h1>New world</h1>
        </div>
        <p className="hint">
          This session lives in this tab. Reloading or closing it discards your worlds.
        </p>
        <button className="secondary" onClick={() => setLibrary(true)}>
          Independent template library
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
      const world = registerWorldSnapshot(reviewed?.source ?? draftWorldSnapshot(draft));
      if (reviewed)
        startGeneration(world.id, {
          ...reviewed.input,
          operationId: crypto.randomUUID(),
          expectedVersion: world.version,
        });
      return world;
    },
    onSuccess: (world) => {
      void cache.invalidateQueries({ queryKey: ["worlds"] });
      cache.setQueryData(["world", world.id], session(world.id).snapshot.world);
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
