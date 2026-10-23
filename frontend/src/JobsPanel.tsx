import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelGeneration } from "./generationJobs";
import { ErrorMessage } from "./ErrorMessage";
import { useJobs } from "./useAtlas";
import type { World } from "./types";

export function JobsPanel({ world }: { world: World }) {
  const jobs = useJobs(world.id);
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
          <progress aria-label="Generation progress" value={job.progress} max="1" />
          {job.error && <p className="error">{job.error}</p>}
          {job.diagnostics?.slice(0, 3).map((item, i) => (
            <p key={i} className={item.severity === "error" ? "error" : "hint"}>
              {item.message}
            </p>
          ))}
          {(job.diagnostics?.length ?? 0) > 3 && (
            <p className="hint">And {job.diagnostics!.length - 3} more.</p>
          )}
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
