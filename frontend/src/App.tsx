import { useEffect, useRef, useState } from "react";
import { viewedChrome } from "./carriedPresentation";
import { v4 as uuid } from "uuid";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AtlasContext } from "@atlas/context";
import type { MapRef, SavedMapDocument, RegionSelection, MapDescriptor } from "@atlas/map";
import { executionMode, openFinishedAtlas } from "./finishedAtlasContext";
import { installGenerationPresentation } from "./generationPresentation";
import type { GenerationDraft } from "./generationDraft";
import { GenerationWizard } from "./GenerationWizard";
import { RegionalGeneration } from "./RegionalGeneration";
import type { GenerationWorkflowOptions } from "./useGenerationWorkflow";
import { FinishedMapEditor } from "./FinishedMapEditor";
import { FinishedMapLibrary } from "./FinishedMapLibrary";
import { NewMapDialog } from "./NewMapDialog";
import { FinishedGeneration } from "./FinishedGeneration";
import { LoreEncyclopedia } from "./LoreEncyclopedia";
import { ErrorMessage } from "./ErrorMessage";
import type { CityChoice, GenerationStatus, RealScaleChoice } from "@atlas/context";
import { realScaleFrame } from "./realScale";
import { Brand } from "./Brand";
import {
  childSelection,
  requireIdle,
  useJobResults,
  useRecovery,
  type JobTarget,
} from "./regionalJobs";

export type FinishedContext = AtlasContext<GenerationDraft>;
interface Setup {
  draft: GenerationDraft;
  parent?: MapDescriptor;
  /** The region whose created child `parent` is; its controls open as a modal over that map. */
  selection?: RegionSelection;
}
interface Jobs {
  start(status: GenerationStatus, target: JobTarget | null): void;
  open(reference: MapRef): Promise<void>;
  /** The map open now; asynchronous steps check it before acting on a map. */
  current(): MapRef | null;
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
  const current = useRef<MapRef | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [job, setJob] = useState<GenerationStatus | null>(null);
  const [jobTarget, setJobTarget] = useState<JobTarget | null>(null);
  const [lore, setLore] = useState(false);
  const [library, setLibrary] = useState(false);
  const [newMap, setNewMap] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const map = useQuery({
    queryKey: ["finished-map", opened?.reference],
    enabled: !!opened,
    queryFn: ({ signal }) => context.maps.open(opened!.reference, { signal }),
  });
  const open = async (reference: MapRef, saved?: SavedMapDocument) => {
    const request = ++opening.current;
    try {
      const stored = saved ?? (await context.library.find(reference.mapId)) ?? undefined;
      if (request !== opening.current) return;
      if (saved) cache.setQueryData(["map-navigation", reference], saved.navigation);
      current.current = reference;
      setOpened({ reference, saved: stored, instance: request });
      // Refinement controls stay open over the child map they belong to.
      setSetup((setup) =>
        setup?.selection && sameMap(setup.parent?.reference, reference) ? setup : null
      );
      setLibrary(false);
    } catch (error) {
      if (request === opening.current) setError(error);
    }
  };
  const jobs: Jobs = {
    start: (status, target) => {
      results.restart();
      setJob(status);
      setJobTarget(target);
    },
    open,
    current: () => current.current,
  };
  const generation = useGenerationSetup(context, map.data, setError, jobs);
  const { setSetup } = generation;
  const results = useJobResults({
    ...{ context, cache, target: jobTarget, current: jobs.current, open, setError },
    ...{ offer: generation.offer, close: () => setJob(null) },
  });
  const { start } = jobs;
  const { complete, published } = results;
  return {
    context,
    opened,
    ...generation,
    job,
    lore,
    library,
    error,
    map,
    open,
    complete,
    published,
    setJob,
    start,
    setLore,
    setLibrary,
    newMap,
    setNewMap,
    setOpened,
    ...useRecovery(jobTarget, { close: () => setJob(null), open, refine: generation.refine }),
    observe(job: GenerationStatus) {
      start(job, null);
      setLibrary(false);
    },
  };
}
const sameMap = (map: MapRef | undefined, reference: MapRef) =>
  map?.mapId === reference.mapId && map.revision === reference.revision;
function useGenerationSetup(
  context: FinishedContext,
  map: MapDescriptor | undefined,
  setError: (error: unknown) => void,
  jobs: Jobs
) {
  const cache = useQueryClient();
  const [setup, setSetup] = useState<Setup | null>(null);
  const create = async () => {
    try {
      const draft = await generationDefaults(context);
      setSetup({ draft: { ...draft, worldId: uuid() } });
    } catch (error) {
      setError(error);
    }
  };
  /** Show the refinement modal over the opened child; Generate regenerates that child. */
  const offer = async (child: MapRef, selection: RegionSelection) => {
    try {
      await generationDefaults(context);
      const [draft, parent] = await Promise.all([
        context.generation.configuration(child),
        context.maps.open(child),
      ]);
      // The controls belong over the child; if another map opened meanwhile, they are not shown.
      if (jobs.current()?.mapId === child.mapId) setSetup({ draft, parent, selection });
    } catch (error) {
      setError(error);
    }
  };
  // owner-direction(2026-11-16): when refining a region, create the child map first, drop the user into it, then offer the refinement controls
  // A real-scale map (ADR 0016) is captured the same way, at its real-scale frame.
  const refine = async (
    selection: RegionSelection,
    name: string,
    child?: MapRef,
    realScale?: RealScaleChoice,
    city?: CityChoice
  ) => {
    try {
      if (child) {
        await jobs.open(child);
        return await offer(child, selection);
      }
      const draft = await context.generation.configuration(selection.parent);
      const size = realScale ? realScaleFrame(realScale) : {};
      const status = await context.generation.refine({
        selection,
        configuration: { ...draft, name, ...size },
        ...(realScale ? { realScale } : {}),
        ...(city ? { city } : {}),
      });
      jobs.start(status, { selection, creates: true });
    } catch (error) {
      setError(error);
    }
  };
  const regenerate = async () => {
    if (!map) return;
    try {
      // A refined child regenerates through the refinement modal over itself.
      const selection = await childSelection(context, cache, map);
      if (selection) return await offer(map.reference, selection);
      await generationDefaults(context);
      setSetup({ draft: await context.generation.configuration(map.reference), parent: map });
    } catch (error) {
      setError(error);
    }
  };
  return { setup, setSetup, create, refine, offer, regenerate };
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
function Atlas({ context }: { context: FinishedContext }) {
  const state = useAtlas(context);
  const { setup, job, lore, library, error, map, open, setJob, setLore, setLibrary } = state;
  if (lore) return <LoreEncyclopedia onClose={() => setLore(false)} />;
  return (
    <>
      <AtlasContent state={state} />
      <ErrorMessage error={error ?? map.error} />
      {setup?.parent && <AtlasSetup state={state} />}
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
      {state.newMap && (
        <NewMapDialog
          editing={context.editing}
          close={() => state.setNewMap(false)}
          open={(reference) => {
            state.setNewMap(false);
            void open(reference);
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
          adjust={state.adjust}
          stopped={state.stopped}
        />
      )}
    </>
  );
}
function AtlasContent({ state }: { state: ReturnType<typeof useAtlas> }) {
  const { setup, map, opened, context } = state;
  // What the viewer chose to show, handed to whichever map opens next.
  const [viewed] = useState(viewedChrome);
  if (setup && !setup.parent) return <AtlasSetup state={state} />;
  if (!map.data || !opened) return <AtlasWelcome state={state} />;
  return (
    <FinishedMapEditor
      key={opened.instance}
      context={context}
      map={map.data}
      saved={opened.saved}
      viewed={viewed}
      open={state.open}
      create={() => void state.create()}
      newMap={() => state.setNewMap(true)}
      lore={() => state.setLore(true)}
      library={() => state.setLibrary(true)}
      refine={(selection, name, child, realScale, city) =>
        void state.refine(selection, name, child, realScale, city)
      }
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
        <button onClick={() => state.setNewMap(true)}>New map</button>
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
  const { context, setSetup, start } = state;
  const setup = state.setup!;
  const options: GenerationWorkflowOptions = {
    initial: setup.draft,
    service: context.generation,
    source: setup.parent,
    onCancel: () => setSetup(null),
    onGenerate: async (draft) => {
      if (setup.parent) await requireIdle(context, setup.parent.reference);
      const status = setup.parent
        ? await context.generation.regenerate(setup.parent.reference, draft)
        : await context.generation.create(draft);
      const child = setup.parent?.reference;
      start(status, setup.selection ? { selection: setup.selection, creates: false, child } : null);
      setSetup(null);
    },
  };
  // owner-direction(2026-11-17): regenerate map opens a modal over the current map
  if (setup.parent) return <RegionalGeneration {...options} />;
  return (
    <main className="setup-page">
      <header className="setup-page-header">
        <Brand />
        <h1>{setup.parent ? "Regenerate map" : "New world"}</h1>
      </header>
      <GenerationWizard key={setup.draft.worldId + setup.draft.name} {...options} />
    </main>
  );
}
