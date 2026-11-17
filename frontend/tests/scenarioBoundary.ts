import type { GenerationStatus } from "@atlas/context";

interface SuppliedCall {
  method: string;
  request?: {
    recipe?: unknown;
    job_id?: string;
    selection?: unknown;
    configuration?: unknown;
    realScale?: unknown;
    reference?: unknown;
  };
}
interface ScenarioOptions {
  rendering: boolean;
  generation?: boolean;
}

declare global {
  interface Window {
    atlasScenario: { rendering: boolean; generation: boolean };
    generationFixtureInput?: unknown;
    generationCalls: string[];
    generationFixtureJobs?: GenerationStatus[];
    /** The whole request of the last supplied create, refine or regenerate call. */
    generationFixtureRequest?: SuppliedCall["request"];
    /** The prepared map a supplied Refine reply publishes as the created child. */
    generationFixtureChild?: unknown;
  }
}

export function assertGenerationScenario() {
  if (window.atlasScenario?.generation) return;
  const message =
    "Browser scenario policy: use openFixtureMap for setup; worker lifecycle tests must declare @generation or generationLifecycle.";
  console.error(message);
  throw new Error(message);
}

/** Runs in each page. Numerical preconditions remain real; raster presentation is opt-in. */
export function installScenarioBoundary({ rendering, generation = false }: ScenarioOptions) {
  window.atlasScenario = { rendering, generation };
  window.generationCalls = [];
  const NativeWorker = window.Worker;
  window.Worker = new Proxy(NativeWorker, {
    construct(target, args) {
      const url = String(args[0]);
      if (url.includes("generation.worker"))
        throw new Error("UI scenarios must use supplied maps, never real generation.");
      if (!rendering && url.includes("raster.worker")) {
        const message =
          "Browser scenario policy: raster rendering requires @rendering and a visual assertion.";
        console.error(message);
        throw new Error(message);
      }
      const worker: Worker = Reflect.construct(target, args);
      if (url.includes("atlasContext.worker")) {
        const send = worker.postMessage.bind(worker);
        const completed = {
          jobId: "supplied-job",
          state: "completed",
          step: "Map published",
          progress: 1,
          result: null as unknown,
          message: null,
        };
        const jobReply = (call: SuppliedCall) => {
          if (call.method === "jobs" && window.generationFixtureJobs)
            return window.generationFixtureJobs;
          const job = window.generationFixtureJobs?.find(
            (job) => job.jobId === call.request?.job_id
          );
          if (call.method === "resume" && job)
            return Object.assign(job, { state: "running", step: "Resuming latest checkpoint" });
          return call.method === "observe" && job
            ? { events: [{ kind: "status", status: job }], status: job, next: 1 }
            : null;
        };
        // Refine's job publishes its child into the working store; reading the prepared child
        // copies it there before the app attaches it to the parent's region.
        const published = () => {
          const child = window.generationFixtureChild;
          const read = { service: "maps", call: { method: "open", args: [child] } };
          if (child) send({ id: 0, operation: read });
          return child;
        };
        const supplied = (call: SuppliedCall | null) => {
          if (!generation || !call) return null;
          const reply = jobReply(call);
          if (reply) return reply;
          if (["create", "refine", "regenerate"].includes(call.method)) {
            window.generationFixtureInput = structuredClone(
              call.method === "create" ? call.request!.recipe : call.request!.configuration
            );
            window.generationFixtureRequest = structuredClone(call.request);
            const result = call.method === "refine" ? published() : null;
            return Object.assign(completed, { result });
          }
          if (call.method === "observe" && call.request?.job_id === completed.jobId)
            return { events: [{ kind: "status", status: completed }], status: completed, next: 1 };
          return null;
        };
        worker.postMessage = (value, options?: Transferable[] | StructuredSerializeOptions) => {
          const call = value?.operation?.service === "generation" ? value.operation.call : null;
          if (call) window.generationCalls.push(call.method);
          const reply = supplied(call);
          const event = new MessageEvent("message", { data: { id: value.id, value: reply } });
          if (reply) return queueMicrotask(() => worker.dispatchEvent(event));
          if (call && ["create", "refine", "regenerate", "resume"].includes(call.method))
            throw new Error("UI scenarios must supply job output, never run real generation.");
          send(value, Array.isArray(options) ? { transfer: options } : options);
        };
      }
      return worker;
    },
  });
}
