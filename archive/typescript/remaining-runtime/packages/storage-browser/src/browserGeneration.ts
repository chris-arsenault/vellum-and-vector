import {
  generation_defaults,
  normalize_generation_configuration,
  generation_presentation,
  choose_generation_configuration,
} from "@atlas/engine";
import type {
  GenerationService,
  GenerationAction,
  GenerationEvent,
  GenerationStatus,
  RefinementSubmission,
} from "@atlas/context";
import type { MapRef, ReadOptions } from "@atlas/map";
import { importInputs, openInputCatalog, savedInputs } from "./browserInputCatalog";
import type { openMapWorkspace } from "./mapWorkspace";
import { runBrowserGeneration, readBrowserGeneration } from "./browserGenerationJob";
import type { Database } from "./catalogDatabase";

interface Job {
  status: GenerationStatus;
  controller: AbortController;
  events: GenerationEvent[];
  listeners: Set<() => void>;
  done: Promise<void>;
}
/** Worker lifecycle and transport only. The Rust job owns every domain and storage operation. */
export class BrowserGeneration<Configuration> implements GenerationService<Configuration> {
  private running = new Map<string, Job>();
  constructor(
    private maps: Awaited<ReturnType<typeof openMapWorkspace>>,
    private database: Database,
    private prepare: (reference: MapRef) => Promise<void> = async () => {}
  ) {}
  async jobs() {
    return [...this.running.values()].map((job) => job.status);
  }
  async configurations() {
    const defaults = JSON.parse(generation_defaults()) as {
      width: number;
      height: number;
      recipe: unknown;
    };
    return [
      {
        id: "atlas",
        title: "Atlas",
        values: { ...defaults, name: "", worldId: crypto.randomUUID() } as Configuration,
      },
    ];
  }
  async validate(configuration: Configuration) {
    return JSON.parse(
      normalize_generation_configuration(JSON.stringify(configuration))
    ) as Configuration;
  }
  async presentation() {
    return JSON.parse(generation_presentation()) as unknown[];
  }
  async configuration(reference: MapRef) {
    await this.prepare(reference);
    return (await readBrowserGeneration(this.maps, this.database, {
      configuration: reference,
    })) as Configuration;
  }
  async review(action: GenerationAction<Configuration>) {
    if (action.method === "refine") await this.prepare(action.request.selection.parent);
    if (action.method === "regenerate") await this.prepare(action.request.reference);
    return readBrowserGeneration(this.maps, this.database, { review: action });
  }
  async choose(configuration: Configuration, control: string, choice: string) {
    return JSON.parse(
      choose_generation_configuration(JSON.stringify({ configuration, control, choice }))
    ) as Configuration;
  }
  async create(configuration: Configuration) {
    return this.start({ method: "create", request: await this.validate(configuration) });
  }
  async refine(request: RefinementSubmission<Configuration>) {
    await this.prepare(request.selection.parent);
    return this.start({
      method: "refine",
      request: { ...request, configuration: await this.validate(request.configuration) },
    });
  }
  async regenerate(reference: MapRef, configuration: Configuration) {
    await this.prepare(reference);
    return this.start({
      method: "regenerate",
      request: { reference, configuration: await this.validate(configuration) },
    });
  }
  async status(jobId: string) {
    return this.job(jobId).status;
  }
  events(jobId: string, after: number) {
    const job = this.job(jobId);
    if (!Number.isInteger(after) || after < 0 || after > job.events.length)
      throw new Error("Unknown generation event cursor.");
    return { events: job.events.slice(after), next: job.events.length, status: job.status };
  }
  async cancel(jobId: string) {
    const job = this.job(jobId);
    if (job.status.state === "running") job.controller.abort();
    return job.status;
  }
  async *observe(jobId: string, options?: ReadOptions): AsyncIterable<GenerationEvent> {
    const job = this.job(jobId);
    let cursor = 0;
    while (true) {
      options?.signal?.throwIfAborted();
      while (cursor < job.events.length) yield job.events[cursor++];
      if (job.status.state !== "running") return;
      await changed(job, options?.signal);
    }
  }
  async close() {
    for (const job of this.running.values()) job.controller.abort();
    await Promise.all([...this.running.values()].map((job) => job.done));
  }
  private job(id: string) {
    const job = this.running.get(id);
    if (!job) throw new Error("Generation job was not found.");
    return job;
  }
  private start(action: unknown) {
    const jobId = crypto.randomUUID();
    const status: GenerationStatus = {
      jobId,
      state: "running",
      step: "Preparing map",
      progress: null,
      result: null,
      message: null,
    };
    const job: Job = {
      status,
      controller: new AbortController(),
      events: [{ kind: "status", status }],
      listeners: new Set(),
      done: Promise.resolve(),
    };
    this.running.set(jobId, job);
    job.done = this.execute(job, action);
    return status;
  }
  private async execute(job: Job, action: unknown) {
    const event = (event: GenerationEvent) => {
      job.events.push(event);
      for (const notify of job.listeners) notify();
    };
    const status = (change: Partial<GenerationStatus>) => {
      job.status = { ...job.status, ...change };
      event({ kind: "status", status: job.status });
    };
    try {
      const result = await runBrowserGeneration(
        this.maps,
        this.database,
        action,
        job.status.jobId,
        { signal: job.controller.signal, status, event }
      );
      status({ state: "completed", result, step: "Map published", progress: 1 });
    } catch (error) {
      status({
        state: job.controller.signal.aborted ? "cancelled" : "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
function changed(job: Job, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const clean = () => {
      job.listeners.delete(notify);
      signal?.removeEventListener("abort", abort);
    };
    const notify = () => {
      clean();
      resolve();
    };
    const abort = () => {
      clean();
      reject(signal?.reason);
    };
    job.listeners.add(notify);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
export async function openBrowserGeneration<Configuration>(
  maps: Awaited<ReturnType<typeof openMapWorkspace>>,
  ensure: (reference: MapRef) => Promise<void> = async () => {}
) {
  const local = await openInputCatalog(`inputs_session_${crypto.randomUUID()}`, true);
  const generation = new BrowserGeneration<Configuration>(maps, local.db, async (reference) => {
    await ensure(reference);
    await importInputs(local, reference);
  });
  return {
    generation,
    async retain(request: import("@atlas/map").SaveMapRequest) {
      const references = maps.catalog.rust.save_references(JSON.stringify(request));
      await savedInputs((saved) => saved.inputs.copy_from(local.source, references));
    },
    async close() {
      await generation.close();
      await local.close();
    },
  };
}
