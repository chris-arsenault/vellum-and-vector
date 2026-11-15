import type {
  GenerationConfiguration,
  GenerationAction,
  GenerationEvent,
  GenerationService,
  GenerationStatus,
  RefinementSubmission,
} from "@atlas/context";
import type { MapRef, ReadOptions } from "@atlas/map";

/** Only creator choices, map selections and presentation events cross the remote facade. */
export interface GenerationCall {
  method: string;
  request?: unknown;
}
export type GenerationTransport = (call: GenerationCall, options?: ReadOptions) => Promise<unknown>;
// Arconis: docs/architecture/subsystems.arconis#item=j_facade — one generation call set used on both hosts.
export class RpcGeneration<Configuration> implements GenerationService<Configuration> {
  constructor(private send: GenerationTransport) {}
  jobs(options?: ReadOptions) {
    return this.call<GenerationStatus[]>("jobs", undefined, options);
  }
  private async call<T>(method: string, request?: unknown, options?: ReadOptions): Promise<T> {
    options?.signal?.throwIfAborted();
    return (await this.send(
      { method, ...(request === undefined ? {} : { request }) },
      options
    )) as T;
  }
  configurations(options?: ReadOptions) {
    return this.call<GenerationConfiguration<Configuration>[]>(
      "configurations",
      undefined,
      options
    );
  }
  validate(configuration: Configuration, options?: ReadOptions) {
    return this.call<Configuration>("validate", configuration, options);
  }
  presentation(options?: ReadOptions) {
    return this.call<unknown[]>("presentation", undefined, options);
  }
  configuration(reference: MapRef, options?: ReadOptions) {
    return this.call<Configuration>("configuration", reference, options);
  }
  review(action: GenerationAction<Configuration>, options?: ReadOptions) {
    return this.call<unknown>("review", action, options);
  }
  choose(configuration: Configuration, control: string, choice: string, options?: ReadOptions) {
    return this.call<Configuration>("choose", { configuration, control, choice }, options);
  }
  create(configuration: Configuration, options?: ReadOptions) {
    return this.call<GenerationStatus>("create", configuration, options);
  }
  refine(request: RefinementSubmission<Configuration>, options?: ReadOptions) {
    return this.call<GenerationStatus>("refine", request, options);
  }
  regenerate(reference: MapRef, configuration: Configuration, options?: ReadOptions) {
    return this.call<GenerationStatus>("regenerate", { reference, configuration }, options);
  }
  status(jobId: string, options?: ReadOptions) {
    return this.call<GenerationStatus>("status", { job_id: jobId }, options);
  }
  cancel(jobId: string, options?: ReadOptions) {
    return this.call<GenerationStatus>("cancel", { job_id: jobId }, options);
  }
  async *observe(jobId: string, options?: ReadOptions): AsyncIterable<GenerationEvent> {
    let after = 0;
    while (true) {
      const page = await this.call<{
        events: GenerationEvent[];
        next: number;
        status: GenerationStatus;
      }>("observe", { job_id: jobId, after }, options);
      for (const event of page.events) {
        if (event.kind === "preview") event.map.bytes = new Uint8Array(event.map.bytes);
        yield event;
      }
      after = page.next;
      if (page.status.state !== "running") return;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(options?.signal?.reason);
        };
        const timer = setTimeout(() => {
          options?.signal?.removeEventListener("abort", abort);
          resolve();
        }, 250);
        options?.signal?.addEventListener("abort", abort, { once: true });
        if (options?.signal?.aborted) abort();
      });
    }
  }
}
