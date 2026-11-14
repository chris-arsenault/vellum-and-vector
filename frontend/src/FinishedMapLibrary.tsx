import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { SavedMap, SavedMapDocument } from "@atlas/map";
import type { FinishedContext } from "./App";
import { ErrorMessage } from "./ErrorMessage";
import type { GenerationStatus } from "@atlas/context";

export function FinishedMapLibrary({
  context,
  close,
  open,
  observe,
}: {
  context: FinishedContext;
  close(): void;
  open(saved: SavedMapDocument): void;
  observe(job: GenerationStatus): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [showJobs, setShowJobs] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const maps = useQuery({
    queryKey: ["saved-maps", context.mode],
    queryFn: async () => {
      const entries: SavedMap[] = [];
      let cursor: string | undefined;
      do {
        const page = await context.library.list(cursor);
        entries.push(...page.items);
        cursor = page.next ?? undefined;
      } while (cursor);
      return entries;
    },
  });
  const opening = useMutation({
    mutationFn: (id: string) => context.library.open(id),
    onSuccess: open,
  });
  return (
    <dialog ref={dialog} className="saved-maps-dialog" aria-label="Saved maps" onCancel={close}>
      <header className="saved-maps-heading">
        <h2>Saved maps</h2>
        <button onClick={close} aria-label="Close saved maps">
          ×
        </button>
      </header>
      {maps.isPending && <p>Loading saved maps…</p>}
      {maps.data?.length === 0 && <p>No saved maps yet. Generate a map and choose Save map.</p>}
      <div className="saved-map-list">
        {maps.data?.map((map) => (
          <button
            key={map.reference.mapId}
            disabled={opening.isPending}
            onClick={() => opening.mutate(map.reference.mapId)}
          >
            <strong>{map.name}</strong>
            <small>{new Date(map.savedAt).toLocaleString()}</small>
          </button>
        ))}
      </div>
      <details onToggle={(event) => setShowJobs(event.currentTarget.open)}>
        <summary>
          {context.mode === "backend" ? "Server generation jobs" : "This tab’s generation jobs"}
        </summary>
        {showJobs && <HostJobs context={context} observe={observe} />}
      </details>
      <ErrorMessage error={maps.error ?? opening.error} />
    </dialog>
  );
}

function HostJobs({
  context,
  observe,
}: {
  context: FinishedContext;
  observe(job: GenerationStatus): void;
}) {
  const jobs = useQuery({
    queryKey: ["generation-jobs", context.mode],
    queryFn: ({ signal }) => context.generation.jobs({ signal }),
    refetchInterval: 2000,
  });
  return (
    <section aria-label="Generation jobs">
      <h3>
        {context.mode === "backend" ? "Server generation jobs" : "This tab’s generation jobs"}
      </h3>
      {jobs.data?.length === 0 && <p>No generation jobs.</p>}
      <div className="saved-map-list">
        {jobs.data?.map((job) => (
          <button key={job.jobId} onClick={() => observe(job)}>
            <strong>{job.step}</strong>
            <small>
              {job.state} · {job.jobId.slice(0, 8)}
            </small>
          </button>
        ))}
      </div>
      <ErrorMessage error={jobs.error} />
    </section>
  );
}
