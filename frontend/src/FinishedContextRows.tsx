import type { DeleteContext, GenerationStatus, StoredContext } from "@atlas/context";
import type { LibraryState } from "./useContextLibrary";

export function ContextMapRow({ map, state }: { map: StoredContext; state: LibraryState }) {
  return (
    <article className="context-row" aria-label={map.name}>
      <button
        disabled={!!map.problem || state.opening.isPending || !map.complete}
        onClick={() => state.opening.mutate(map)}
      >
        <strong>{map.name}</strong>
        <small>
          {map.profile} · {map.complete ? "Complete" : "Incomplete"}
          {map.saved ? " · Saved view" : ""}
        </small>
      </button>
      {map.problem && <p role="status">Cannot open: {map.problem}</p>}
      <div className="context-actions">
        <button onClick={() => state.select(map)}>Regions and jobs for {map.name}</button>
        <button
          onClick={() =>
            state.confirmDelete({
              target: { kind: "map", id: map.reference.mapId, descendants: false },
              name: map.name,
            })
          }
        >
          Delete {map.name}
        </button>
      </div>
    </article>
  );
}
export function ContextJobRow({ job, state }: { job: GenerationStatus; state: LibraryState }) {
  const name = job.details?.name ?? job.step;
  return (
    <article className="context-row" aria-label={name}>
      <button onClick={() => state.props.observe(job)}>
        <strong>{name}</strong>
        <small>{job.state}</small>
        <span>{job.state === "completed" && job.result ? "Open map" : job.step}</span>
      </button>
      {job.recovery?.checkpoint && <small>Resume from: {job.recovery.checkpoint}</small>}
      {job.recovery?.problem && <p role="status">{job.recovery.problem}</p>}
      <ContextJobActions job={job} state={state} />
    </article>
  );
}
function ContextJobActions({ job, state }: { job: GenerationStatus; state: LibraryState }) {
  const stopped = !["running", "completed"].includes(job.state);
  return (
    <div className="context-actions">
      {stopped && (
        <button
          disabled={!!job.recovery?.problem || state.resume.isPending}
          onClick={() => state.resume.mutate(job)}
        >
          {job.recovery?.checkpoint ? "Resume generation" : "Restart from beginning"}
        </button>
      )}
      <button
        disabled={job.state === "running"}
        onClick={() =>
          state.confirmDelete({
            target: { kind: "job", id: job.jobId },
            name: job.details?.name ?? "generation job",
          })
        }
      >
        Delete job
      </button>
    </div>
  );
}
export function DeleteContextPrompt({ state }: { state: LibraryState }) {
  const pending = state.deleting;
  if (!pending) return null;
  const target = pending.target;
  return (
    <section className="context-delete" role="alertdialog" aria-label={`Delete ${pending.name}`}>
      <h3>Delete {pending.name}?</h3>
      <DeleteExplanation target={target} />
      {target.kind === "map" && (
        <label>
          <input
            type="checkbox"
            checked={target.descendants}
            onChange={(e) =>
              state.confirmDelete({
                ...pending,
                target: { ...target, descendants: e.target.checked },
              })
            }
          />
          Also delete descendant regions
        </label>
      )}
      <div className="context-actions">
        <button disabled={state.remove.isPending} onClick={() => state.remove.mutate(target)}>
          Confirm delete
        </button>
        <button disabled={state.remove.isPending} onClick={() => state.confirmDelete(null)}>
          Keep it
        </button>
      </div>
    </section>
  );
}
function DeleteExplanation({ target }: { target: DeleteContext }) {
  if (target.kind === "map")
    return (
      <p>
        Delete this map, its revisions and saved views. Independent children remain accessible
        unless selected below. Shared data needed by surviving maps is retained.
      </p>
    );
  if (target.kind === "job")
    return <p>Delete the job and its recovery data. Its completed map remains available.</p>;
  return <p>Remove this unattached record and data no surviving map or job uses.</p>;
}
