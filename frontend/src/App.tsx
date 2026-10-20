import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ErrorMessage } from "./ErrorMessage";
import { createWorld, session } from "./atlasState";
import { startGeneration } from "./generationJobs";
import { GenerationWizard } from "./GenerationWizard";
import { draftPreview, type GenerationDraft } from "./generationDraft";
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
          onCancel={world.data ? () => setCreating(false) : undefined}
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

function CreateWorld({
  onCreate,
  onCancel,
}: {
  onCreate: (id: string) => void;
  onCancel?: () => void;
}) {
  const cache = useQueryClient();
  const create = useMutation({
    mutationFn: async ({ draft, generate }: { draft: GenerationDraft; generate: boolean }) => {
      if (generate) {
        const preview = draftPreview(draft);
        if (preview.diagnostics.some((item) => item.severity === "error"))
          throw new Error(preview.diagnostics.map((item) => item.message).join("\n"));
      }
      const world = createWorld({
        name: draft.name,
        width: draft.width,
        height: draft.height,
        seed: draft.recipe.seed,
        settings: draft.recipe.settings,
      });
      if (generate)
        startGeneration(world.id, {
          ...draft.recipe,
          areaId: Object.keys(world.areas)[0],
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
      onGenerate={async (draft) => {
        await create.mutateAsync({ draft, generate: true });
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
