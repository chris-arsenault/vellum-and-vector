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
  const records = jobs.data ?? [];
  if (!records.length && !jobs.error) return null;
  return (
    <section className="jobs-panel">
      <div className="section-title">
        <span>GENERATION JOBS</span>
        <span>{records.filter((j) => ["running", "queued"].includes(j.status)).length} active</span>
      </div>
      {!records.length && (
        <p className="hint">Generation runs in this tab. You can pan and inspect while it works.</p>
      )}
      {records.slice(0, 1).map((job) => (
        <JobRow key={job.id} job={job} cancel={control.mutate} />
      ))}
      {records.length > 1 && (
        <details>
          <summary>Earlier generations ({records.length - 1})</summary>
          {records.slice(1).map((job) => (
            <JobRow key={job.id} job={job} cancel={control.mutate} />
          ))}
        </details>
      )}
      <ErrorMessage error={jobs.error ?? control.error} />
    </section>
  );
}
type Job = NonNullable<ReturnType<typeof useJobs>["data"]>[number];
function JobRow({ job, cancel }: { job: Job; cancel: (id: string) => void }) {
  return (
    <div className="job-row">
      <div>
        <strong>{job.status}</strong>
      </div>
      <p>{job.stage}</p>
      <progress aria-label="Generation progress" value={job.progress} max="1" />
      {job.error && <p className="error">{job.error}</p>}
      {!!job.diagnostics?.length && (
        <details>
          <summary>Inspect diagnostics ({job.diagnostics.length})</summary>
          {job.diagnostics.map((item, i) => (
            <details key={i}>
              <summary>{item.message}</summary>
              <pre>{JSON.stringify(item, null, 2)}</pre>
            </details>
          ))}
        </details>
      )}
      {["running", "queued"].includes(job.status) && (
        <button className="quiet" onClick={() => cancel(job.id)}>
          Cancel generation
        </button>
      )}
    </div>
  );
}
