import { useEffect, useRef } from "react";
import { ErrorMessage } from "./ErrorMessage";
import { ContextJobRow, ContextMapRow, DeleteContextPrompt } from "./FinishedContextRows";
import { useContextLibrary, type LibraryProps, type LibraryState } from "./useContextLibrary";

// owner-direction(2026-11-15): list worlds, regions, generations, including orphans; weave it into the UI
export function FinishedMapLibrary(props: LibraryProps) {
  const state = useContextLibrary(props);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = props.context.mode === "backend" ? "Server maps" : "Saved maps";
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog ref={dialog} className="saved-maps-dialog" aria-label={title} onCancel={props.close}>
      <header className="saved-maps-heading">
        <h2>{title}</h2>
        <button onClick={props.close} aria-label={`Close ${title.toLowerCase()}`}>
          ×
        </button>
      </header>
      <button
        onClick={() => {
          void state.inventory.refetch();
          void state.jobs.refetch();
        }}
      >
        Refresh library
      </button>
      {state.inventory.isPending && <p>Loading maps…</p>}
      {state.inventory.data && <ContextContents state={state} />}
      <DeleteContextPrompt state={state} />
      <ErrorMessage
        error={
          state.inventory.error ??
          state.jobs.error ??
          state.opening.error ??
          state.resume.error ??
          state.remove.error
        }
      />
    </dialog>
  );
}
function ContextContents({ state }: { state: LibraryState }) {
  const inventory = state.inventory.data!;
  const current = inventory.maps.filter((map) => map.head || !map.complete);
  const selected = state.selected;
  const visible = selected
    ? current.filter((map) => map.parent?.mapId === selected.reference.mapId)
    : current.filter((map) => !map.parent);
  const jobs = state.jobs.data ?? inventory.jobs;
  const associated = selected
    ? jobs.filter(
        (job) =>
          job.details?.parent?.mapId === selected.reference.mapId ||
          job.result?.mapId === selected.reference.mapId
      )
    : jobs;
  return (
    <>
      <ContextBreadcrumb state={state} />
      {selected && <ContextMapRow map={selected} state={state} />}
      <h3>{selected ? "Regions" : "Worlds"}</h3>
      {visible.length === 0 && (
        <p>
          {selected
            ? "No retained regions yet."
            : "No worlds yet. Generation results and saved maps appear here."}
        </p>
      )}
      <div className="saved-map-list">
        {visible.map((map) => (
          <ContextMapRow
            key={`${map.reference.mapId}:${map.reference.revision}`}
            map={map}
            state={state}
          />
        ))}
      </div>
      <details open={!!selected} onToggle={(event) => state.setShowJobs(event.currentTarget.open)}>
        <summary>Generation jobs</summary>
        <div className="saved-map-list">
          {associated.map((job) => (
            <ContextJobRow key={job.jobId} job={job} state={state} />
          ))}
        </div>
        {associated.length === 0 && <p>No generation jobs.</p>}
      </details>
      <UnattachedContexts state={state} />
    </>
  );
}
function ContextBreadcrumb({ state }: { state: LibraryState }) {
  const selected = state.selected;
  if (!selected) return null;
  const parent = state.inventory.data!.maps.find(
    (map) => map.reference.mapId === selected.parent?.mapId && map.head
  );
  return (
    <nav className="context-actions" aria-label="Library ancestry">
      <button onClick={() => state.select(null)}>All worlds</button>
      {parent && <button onClick={() => state.select(parent)}>{parent.name}</button>}
      <span>{selected.name}</span>
    </nav>
  );
}
function UnattachedContexts({ state }: { state: LibraryState }) {
  const inventory = state.inventory.data!;
  const ids = new Set(inventory.maps.map((map) => map.reference.mapId));
  const unattached = inventory.maps.filter(
    (map) => (map.parent && !ids.has(map.parent.mapId)) || !map.head || map.problem
  );
  return (
    <details>
      <summary>
        Unattached maps, revisions and records ({unattached.length + inventory.orphans.length})
      </summary>
      <div className="saved-map-list">
        {unattached.map((map) => (
          <ContextMapRow
            key={`${map.reference.mapId}:${map.reference.revision}`}
            map={map}
            state={state}
          />
        ))}
      </div>
      {inventory.orphans.map((orphan) => (
        <article className="context-row" key={`${orphan.kind}:${orphan.id}`}>
          <strong>
            {orphan.kind} · {orphan.reference?.mapId ?? orphan.id}
          </strong>
          {orphan.problem && <p>{orphan.problem}</p>}
          <button
            onClick={() =>
              state.confirmDelete({
                target: { kind: "orphan", orphan },
                name: `unattached ${orphan.kind}`,
              })
            }
          >
            Delete unattached {orphan.kind}
          </button>
        </article>
      ))}
      {inventory.problems.map((problem) => (
        <p role="status" key={problem}>
          {problem}
        </p>
      ))}
      {inventory.cleanup.map((id) => (
        <p key={id}>
          Unfinished cleanup{" "}
          <button
            disabled={state.remove.isPending}
            onClick={() => state.remove.mutate({ kind: "cleanup", id })}
          >
            Retry cleanup
          </button>
        </p>
      ))}
    </details>
  );
}
