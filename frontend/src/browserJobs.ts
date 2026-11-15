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
      case "configuration":
        return this.configuration(call.request as MapRef);
      case "review":
        return this.review(call.request as GenerationAction<unknown>);
      case "create":
      case "refine":
      case "regenerate":
        return this.start(call as GenerationAction<unknown>);
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
  private observation(call: GenerationCall) {
    if (call.method === "jobs") return [...this.jobs.values()].map((job) => job.status);
    const request = call.request as { job_id: string; after: number };
    const job = this.jobs.get(request.job_id);
    if (!job) throw new Error("Generation job was not found.");
    switch (call.method) {
      case "cancel":
        if (job.status.state === "running") job.controller.abort();
        return job.status;
      case "status":
        return job.status;
      case "observe": {
        const after = request.after;
        if (!Number.isInteger(after) || after < 0 || after > job.events.length)
          throw new Error("Unknown generation event cursor.");
        return { events: job.events.slice(after), next: job.events.length, status: job.status };
      }
      default:
        throw new Error("Unknown generation operation.");
    }
  }
  private start(action: GenerationAction<unknown>) {
    const status: GenerationStatus = {
      jobId: uuid(),
      state: "running",
      step: "Preparing map",
      progress: null,
      result: null,
      message: null,
    };
    const job: Job = {
      status,
      events: [{ kind: "status", status }],
      controller: new AbortController(),
      done: Promise.resolve(),
    };
    this.jobs.set(status.jobId, job);
    job.done = this.run(job, action);
    return status;
  }
  private async run(job: Job, action: GenerationAction<unknown>) {
    const status = (change: Partial<GenerationStatus>) => {
      job.status = { ...job.status, ...change };
      job.events.push({ kind: "status", status: job.status });
    };
    let run: ReturnType<Workspace["job"]> | undefined;
    try {
      run = this.workspace.job(parent(action));
      const result = JSON.parse(
        await run.run(
          JSON.stringify({
            action,
            operation: job.status.jobId,
            revision: uuid(),
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
