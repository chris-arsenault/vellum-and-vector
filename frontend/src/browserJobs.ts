import type { MainModule } from "@atlas/engine";
import { v4 as uuid } from "uuid";
import type { GenerationAction, GenerationEvent, GenerationStatus } from "@atlas/context";
import type { MapRef } from "@atlas/map";
import type { GenerationCall } from "@atlas/transport";

type Workspace = InstanceType<MainModule["BrowserWorkspace"]>;
interface Job {
  status: GenerationStatus;
  events: GenerationEvent[];
  controller: AbortController;
  done: Promise<void>;
}
const browserCacheBytes = 256 * 1024 * 1024;

// Arconis: docs/architecture/subsystems.arconis#item=j_bw_worker — worker job list with per-job cancel flag.
/** Worker facade: UI observations and cancellation; Rust owns execution and storage. */
export class BrowserJobs {
  private jobs = new Map<string, Job>();
  constructor(
    private engine: MainModule,
    private workspace: Workspace
  ) {}

  async call(call: GenerationCall): Promise<unknown> {
    switch (call.method) {
      case "configurations":
        return [
          {
            id: "atlas",
            title: "Atlas",
            values: {
              ...JSON.parse(this.engine.generation_defaults()),
              name: "",
            },
          },
        ];
      case "presentation":
        return JSON.parse(this.engine.generation_presentation());
      case "validate":
        return JSON.parse(
          this.engine.normalize_generation_configuration(JSON.stringify(call.request))
        );
      case "choose":
        return JSON.parse(
          this.engine.choose_generation_configuration(JSON.stringify(call.request))
        );
      case "review":
        return this.review(call.request as GenerationAction<unknown>);
      case "create":
      case "refine":
      case "regenerate":
        return this.start(call as GenerationAction<unknown>);
      case "resume":
        return this.resume((call.request as { job_id: string }).job_id);
      default:
        return this.observation(call);
    }
  }
  async close() {
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.all([...this.jobs.values()].map((job) => job.done));
  }
  private configuration(reference: MapRef) {
    const job = this.workspace.job(JSON.stringify(reference));
    try {
      return JSON.parse(job.configuration(JSON.stringify(reference)));
    } finally {
      job.free();
    }
  }
  private async review(action: GenerationAction<unknown>) {
    const job = this.workspace.job(parent(action));
    try {
      return JSON.parse(await job.review(JSON.stringify(action), uuid()));
    } finally {
      job.free();
    }
  }
  private async observation(call: GenerationCall) {
    if (call.method === "configuration") return this.configuration(call.request as MapRef);
    if (call.method === "jobs")
      return (await this.stored()).map((status) =>
        this.jobs.get(status.jobId)?.status.state === "running"
          ? this.jobs.get(status.jobId)!.status
          : status
      );
    const request = call.request as { job_id: string; after: number };
    const job = this.jobs.get(request.job_id);
    if (!job) {
      const status = (await this.stored()).find((status) => status.jobId === request.job_id);
      if (!status) throw new Error("Generation job was not found.");
      return call.method === "observe" ? { events: [], next: 0, status } : status;
    }
    return this.observeLive(call.method, request.after, job);
  }
  private async stored() {
    const statuses = JSON.parse(this.workspace.generation_jobs()) as GenerationStatus[];
    const held = new Set((await navigator.locks.query()).held?.map((lock) => lock.name));
    return statuses.map((status) =>
      held.has(`atlas-job-${status.jobId}`)
        ? { ...status, state: "running" as const, step: "Running in a browser tab" }
        : status
    );
  }
  private resume(id: string) {
    if (this.jobs.get(id)?.status.state === "running")
      throw new Error("This job is already running.");
    return this.holdJob(() => JSON.parse(this.workspace.resume_status(id)) as GenerationStatus, id);
  }
  private observeLive(method: string, after: number, job: Job) {
    switch (method) {
      case "cancel":
        if (job.status.state === "running") job.controller.abort();
        return job.status;
      case "status":
        return job.status;
      case "observe": {
        if (!Number.isInteger(after) || after < 0 || after > job.events.length)
          throw new Error("Unknown generation event cursor.");
        return { events: job.events.slice(after), next: job.events.length, status: job.status };
      }
      default:
        throw new Error("Unknown generation operation.");
    }
  }
  private start(action: GenerationAction<unknown>) {
    return this.holdJob(
      () => JSON.parse(this.workspace.start_job(JSON.stringify(action))) as GenerationStatus
    );
  }
  private holdJob(start: () => GenerationStatus, existingId?: string): Promise<GenerationStatus> {
    // Web Locks coordinate worker lifetimes across tabs; Rust still owns every storage write.
    return new Promise((resolve, reject) => {
      void navigator.locks
        .request("atlas-context-mutation", { mode: "shared" }, async () => {
          const status = existingId ? undefined : start();
          await navigator.locks.request(
            `atlas-job-${existingId ?? status!.jobId}`,
            { ifAvailable: true },
            async (lock) => {
              if (!lock) throw new Error("This job is running in another browser tab.");
              const running = status ?? start();
              resolve(this.launch(running));
              await this.jobs.get(running.jobId)!.done;
            }
          );
        })
        .catch(reject);
    });
  }
  private launch(status: GenerationStatus) {
    const job: Job = {
      status,
      events: [{ kind: "status", status }],
      controller: new AbortController(),
      done: Promise.resolve(),
    };
    this.jobs.set(status.jobId, job);
    job.done = this.run(job);
    return status;
  }
  private async run(job: Job) {
    const status = (change: Partial<GenerationStatus>) => {
      job.status = { ...job.status, ...change };
      job.events.push({ kind: "status", status: job.status });
    };
    let run: ReturnType<Workspace["job"]> | undefined;
    try {
      run = this.workspace.retained_job(job.status.jobId);
      const result = JSON.parse(
        await run.run(
          JSON.stringify({
            operation: job.status.jobId,
            revision: job.status.jobId,
            cacheBytes: browserCacheBytes,
          }),
          observations(job, status)
        )
      ) as MapRef;
      status({ state: "completed", result, step: "Map published", progress: 1 });
    } catch (error) {
      status({
        state: job.controller.signal.aborted ? "cancelled" : "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      run?.free();
      const stored = (JSON.parse(this.workspace.generation_jobs()) as GenerationStatus[]).find(
        (status) => status.jobId === job.status.jobId
      );
      if (stored) status(stored);
    }
  }
}
function parent(action: GenerationAction<unknown>) {
  switch (action.method) {
    case "create":
      return undefined;
    case "refine":
      return JSON.stringify(action.request.selection.parent);
    case "regenerate":
      return JSON.stringify(action.request.reference);
  }
}
function observations(job: Job, status: (change: Partial<GenerationStatus>) => void) {
  let epoch = 0;
  return {
    control: {
      cancelled: () => job.controller.signal.aborted,
      progress(json: string) {
        const progress = JSON.parse(json) as { message: string; fraction: number };
        status({ step: progress.message, progress: progress.fraction });
      },
    },
    workProgress(progress: number, step: string) {
      status({ step, progress });
    },
    diagnostic(message: string) {
      status({ message });
    },
    mapChanged(json: string) {
      job.events.push({ kind: "published", reference: JSON.parse(json) as MapRef });
    },
    async preview(json: string) {
      job.events.push({
        kind: "preview",
        jobId: job.status.jobId,
        epoch: epoch++,
        map: {
          mediaType: "application/vnd.atlas.preview+json",
          bytes: new TextEncoder().encode(json),
        },
      });
    },
  };
}
