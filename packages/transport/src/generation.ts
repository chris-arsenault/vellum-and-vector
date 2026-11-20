import type {
  GenerationConfiguration,
  GenerationAction,
  GenerationEvent,
  GenerationService,
  GenerationStatus,
  GenerationWireEvent,
  RefinementSubmission,
} from "@atlas/context";
import type { MapRef, ReadOptions } from "@atlas/map";
import { Decoder } from "cbor-x";
import { cborOptions } from "./cbor";

/** CBOR keeps a missing value as NaN, where JSON wrote null; previews read null. */
function finite(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(finite);
  if (value && typeof value === "object" && !(value instanceof Uint8Array))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, finite(item)]));
  return value;
}

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
  /** A preview's grid: sent with its event by the browser worker as JSON, or retained by the
   * LAN server as CBOR and fetched by epoch. A preview the server no longer keeps is skipped. */
  private async preview(
    jobId: string,
    event: Extract<GenerationWireEvent, { kind: "preview" }>,
    options?: ReadOptions
  ): Promise<unknown> {
    if (event.map) return JSON.parse(new TextDecoder().decode(new Uint8Array(event.map.bytes)));
    let bytes: Uint8Array;
    try {
      bytes = await this.call<Uint8Array>(
        "preview",
        { job_id: jobId, epoch: event.epoch },
        options
      );
    } catch (error) {
      if (String(error).includes("no longer kept")) return undefined;
      throw error;
    }
    return finite(new Decoder(cborOptions).decode(new Uint8Array(bytes)));
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
  resume(jobId: string, options?: ReadOptions) {
    return this.call<GenerationStatus>("resume", { job_id: jobId }, options);
  }
  async *observe(jobId: string, options?: ReadOptions): AsyncIterable<GenerationEvent> {
    let after = 0;
    while (true) {
      const page = await this.call<{
        events: GenerationWireEvent[];
        next: number;
        status: GenerationStatus;
      }>("observe", { job_id: jobId, after }, options);
      for (const event of page.events) {
        if (event.kind !== "preview") {
          yield event;
          continue;
        }
        const preview = await this.preview(jobId, event, options);
        if (preview !== undefined)
          yield { kind: "preview", jobId: event.jobId, epoch: event.epoch, preview };
      }
      after = page.next;
      if (page.status.state !== "running") {
        if (page.status.recovery || page.events.length === 0)
          yield { kind: "status", status: page.status };
        return;
      }
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
