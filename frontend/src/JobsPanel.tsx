import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { cancelGeneration } from "./generationJobs";
import { ErrorMessage } from "./ErrorMessage";
import { useJobs } from "./useAtlas";
import type { World } from "./types";

export function JobsPanel({ world }: { world: World }) {
  const jobs = useJobs(world.id);
  const [now, setNow] = useState(Date.now);
  const active = jobs.data?.some((job) => ["running", "queued"].includes(job.status));
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const cache = useQueryClient();
  const control = useMutation({
    mutationFn: async (id: string) => cancelGeneration(id),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["jobs", world.id] });
    },
  });
  return (
    <section className="jobs-panel">
      <div className="section-title">
        <span>GENERATION JOBS</span>
        <span>
          {jobs.data?.filter((j) => ["running", "queued"].includes(j.status)).length ?? 0} active
        </span>
      </div>
      {!jobs.data?.length && (
        <p className="hint">
          Generation runs in this tab. You can pan, inspect and edit while it works.
        </p>
      )}
      {jobs.data?.slice(0, 5).map((job) => (
        <div key={job.id} className="job-row">
          <div>
            <strong>{job.status}</strong>
          </div>
          <p>{job.stage}</p>
          <p className="hint">
            Elapsed {seconds((job.finishedAt ?? Math.max(now, job.updatedAt)) - job.startedAt)}
            {!job.finishedAt && ` · Last update ${seconds(Math.max(0, now - job.updatedAt))} ago`}
          </p>
          <progress aria-label="Generation progress" value={job.progress} max="1" />
          <details>
            <summary>Generation log ({job.events.length})</summary>
            <ol>
              {job.events.map((event, index) => (
                <li key={index}>
                  <time>{seconds(event.elapsedMs)}</time> {event.message}
                </li>
              ))}
            </ol>
          </details>
          {job.error && <p className="error">{job.error}</p>}
          {["running", "queued"].includes(job.status) && (
            <button className="quiet" onClick={() => control.mutate(job.id)}>
              Cancel generation
            </button>
          )}
        </div>
      ))}
      <ErrorMessage error={jobs.error ?? control.error} />
    </section>
  );
}

function seconds(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}
