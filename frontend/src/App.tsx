import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { AtlasContext } from "@atlas/context";
import type {
  MapRef,
  SavedMapDocument,
  RegionSelection,
  MapDescriptor,
  MapNavigationState,
} from "@atlas/map";
import { executionMode, openFinishedAtlas } from "./finishedAtlasContext";
import { installGenerationPresentation } from "./generationPresentation";
import type { GenerationDraft } from "./generationDraft";
import { GenerationWizard } from "./GenerationWizard";
import { RegionalGeneration } from "./RegionalGeneration";
import type { GenerationWorkflowOptions } from "./useGenerationWorkflow";
import { FinishedMapEditor } from "./FinishedMapEditor";
import { FinishedMapLibrary } from "./FinishedMapLibrary";
import { FinishedGeneration } from "./FinishedGeneration";
import { LoreEncyclopedia } from "./LoreEncyclopedia";
import { ErrorMessage } from "./ErrorMessage";
import type { GenerationStatus } from "@atlas/context";
import { bounds } from "./presentation";
import { Brand } from "./Brand";

export type FinishedContext = AtlasContext<GenerationDraft>;
interface Setup {
  draft: GenerationDraft;
  parent?: MapDescriptor;
  selection?: RegionSelection;
}
interface Opened {
  instance: number;
  reference: MapRef;
  saved?: SavedMapDocument;
}
export function App() {
  const mode = executionMode();
  const [context, setContext] = useState<FinishedContext | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let disposed = false,
      current: FinishedContext | undefined;
    const close = () => {
      const opened = current;
      current = undefined;
      return opened?.dispose();
    };
    void openFinishedAtlas<GenerationDraft>(
      mode,
      import.meta.env.VITE_ATLAS_BACKEND_URL ?? location.origin
    )
      .then((opened) => {
        if (disposed) return opened.dispose();
        current = opened;
        setContext(opened);
      })
      .catch((error: unknown) => {
        void close();
        if (!disposed) setError(error);
      });
    return () => {
      disposed = true;
      void close();
    };
  }, [mode]);
  if (!context)
    return (
      <main className="welcome">
        <Brand />
        <p>Opening atlas…</p>
        <ErrorMessage error={error} />
      </main>
    );
  return <Atlas context={context} />;
}
function useAtlas(context: FinishedContext) {
  const cache = useQueryClient();
  const opening = useRef(0);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [job, setJob] = useState<GenerationStatus | null>(null);
  const [jobSelection, setJobSelection] = useState<RegionSelection | null>(null);
  const [lore, setLore] = useState(false);
  const [library, setLibrary] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const map = useQuery({
    queryKey: ["finished-map", opened?.reference],
    enabled: !!opened,
    queryFn: ({ signal }) => context.maps.open(opened!.reference, { signal }),
  });
  const { setup, setSetup, create, refine, regenerate } = useGenerationSetup(
    context,
    map.data,
    setError
  );
  const open = async (reference: MapRef, saved?: SavedMapDocument) => {
    const request = ++opening.current;
    try {
      const stored = saved ?? (await context.library.find(reference.mapId)) ?? undefined;
      if (request !== opening.current) return;
      if (saved) cache.setQueryData(["map-navigation", reference], saved.navigation);
      setOpened({ reference, saved: stored, instance: request });
      setSetup(null);
      setLibrary(false);
    } catch (error) {
      if (request === opening.current) setError(error);
    }
  };
  const complete = async (reference: MapRef) => {
    try {
      await attachChild(context, cache, jobSelection, reference);
    } catch (error) {
      setError(error);
    }
    await open(reference);
  };
  const published = async (reference: MapRef) => {
    await cache.invalidateQueries({ queryKey: ["finished-map", reference] });
    if (
      opened?.reference.mapId !== reference.mapId ||
      opened.reference.revision !== reference.revision
    )
      await open(reference);
  };
  return {
    context,
    opened,
    setup,
    job,
    lore,
    library,
    error,
    map,
    create,
    refine,
    regenerate,
    open,
    complete,
    published,
    setSetup,
    setJob,
    setJobSelection,
    setLore,
    setLibrary,
    setOpened,
    observe(job: GenerationStatus) {
      setJobSelection(null);
      setJob(job);
      setLibrary(false);
    },
  };
}
function useGenerationSetup(
  context: FinishedContext,
  map: MapDescriptor | undefined,
  setError: (error: unknown) => void
) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const create = async () => {
    try {
      const draft = await generationDefaults(context);
      setSetup({ draft: { ...draft, worldId: uuid() } });
    } catch (error) {
      setError(error);
    }
  };
  const refine = async (selection: RegionSelection, name: string) => {
    try {
      await generationDefaults(context);
      const draft = await context.generation.configuration(selection.parent);
      const [w, s, e, n] = bounds(selection.geometry);
      setSetup({ draft: { ...draft, name, width: e - w, height: n - s }, parent: map, selection });
    } catch (error) {
      setError(error);
    }
  };
  const regenerate = async () => {
    if (!map) return;
    try {
      await generationDefaults(context);
      setSetup({ draft: await context.generation.configuration(map.reference), parent: map });
    } catch (error) {
      setError(error);
    }
  };
  return { setup, setSetup, create, refine, regenerate };
}
async function generationDefaults(context: FinishedContext) {
  const [features, choices] = await Promise.all([
    context.generation.presentation(),
    context.generation.configurations(),
  ]);
  const draft = await context.generation.validate(choices[0].values);
  installGenerationPresentation(features, draft);
  return draft;
}
async function attachChild(
  context: FinishedContext,
  cache: QueryClient,
  selection: RegionSelection | null,
  reference: MapRef
) {
  const selected = selection?.regionPath.at(-1);
  if (selection && selected) {
    const key = ["map-navigation", selection.parent];
    const state = cache.getQueryData<MapNavigationState>(key);
    if (state) {
      const next = await context.navigation.commit(selection.parent, state, {
        kind: "attachChild",
        data: { region_id: selected.id, child: reference },
      });
      cache.setQueryData(key, next);
    }
  }
  await cache.invalidateQueries({ queryKey: ["related-maps"] });
}
function Atlas({ context }: { context: FinishedContext }) {
  const state = useAtlas(context);
  const { setup, job, lore, library, error, map, open, setJob, setLore, setLibrary } = state;
  if (lore) return <LoreEncyclopedia onClose={() => setLore(false)} />;
  return (
    <>
      <AtlasContent state={state} />
      <ErrorMessage error={error ?? map.error} />
      {setup?.selection && <AtlasSetup state={state} />}
      {library && (
        <FinishedMapLibrary
          context={context}
          close={() => setLibrary(false)}
          open={(reference, saved) => open(reference, saved)}
          retained={(ids) => {
            if (state.opened && !ids.has(state.opened.reference.mapId)) state.setOpened(null);
          }}
          observe={(job) => {
            if (job.state === "completed" && job.result) void open(job.result);
            else state.observe(job);
          }}
        />
      )}
      {job && (
        <FinishedGeneration
          key={job.jobId}
          context={context}
          initial={job}
          complete={(reference) => void state.complete(reference)}
          published={(reference) => void state.published(reference)}
          close={() => setJob(null)}
        />
      )}
    </>
  );
}
function AtlasContent({ state }: { state: ReturnType<typeof useAtlas> }) {
  const { setup, map, opened, context } = state;
  if (setup && !setup.selection) return <AtlasSetup state={state} />;
  if (!map.data || !opened) return <AtlasWelcome state={state} />;
  return (
    <FinishedMapEditor
      key={opened.instance}
      context={context}
      map={map.data}
      saved={opened.saved}
      open={state.open}
      create={() => void state.create()}
      lore={() => state.setLore(true)}
      library={() => state.setLibrary(true)}
      refine={(selection, name) => void state.refine(selection, name)}
      regenerate={() => void state.regenerate()}
    />
  );
}
function AtlasWelcome({ state }: { state: ReturnType<typeof useAtlas> }) {
  return (
    <main className="welcome">
      <div className="welcome-card">
        <Brand />
        <h1>Your atlas</h1>
        <p>
          {state.context.mode === "browser"
            ? "Maps run in this browser. Save a map to keep it after closing the tab."
            : "Worlds and regions are kept on your LAN server and available to your home devices."}
        </p>
        <button className="primary" onClick={() => void state.create()}>
          New world
        </button>
        <button onClick={() => state.setLibrary(true)}>
          {state.context.mode === "backend" ? "Server maps" : "Saved maps"}
        </button>
        <button onClick={() => state.setLore(true)}>Magic lore bible</button>
      </div>
    </main>
  );
}
// Arconis: docs/architecture/subsystems.arconis#item=j_app — setup launch for creating, refining or regenerating a map.
function AtlasSetup({ state }: { state: ReturnType<typeof useAtlas> }) {
  const { context, setSetup, setJob, setJobSelection } = state;
  const setup = state.setup!;
  const options: GenerationWorkflowOptions = {
    initial: setup.draft,
    service: context.generation,
    source: setup.parent,
    selection: setup.selection,
    onCancel: () => setSetup(null),
    onGenerate: async (draft) => {
      const status = setup.selection
        ? await context.generation.refine({ selection: setup.selection, configuration: draft })
        : setup.parent
          ? await context.generation.regenerate(setup.parent.reference, draft)
          : await context.generation.create(draft);
      setJob(status);
      setJobSelection(setup.selection ?? null);
      setSetup(null);
    },
  };
  if (setup.selection) return <RegionalGeneration {...options} />;
  return (
    <main className="setup-page">
      <header className="setup-page-header">
        <Brand />
        <h1>{setup.selection ? "Refine region" : setup.parent ? "Regenerate map" : "New world"}</h1>
      </header>
      <GenerationWizard key={setup.draft.worldId + setup.draft.name} {...options} />
    </main>
  );
}
