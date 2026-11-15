import type { GenerationStatus } from "@atlas/context";

interface SuppliedCall {
  method: string;
  request?: { recipe?: unknown; job_id?: string; selection?: unknown; configuration?: unknown };
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
    generationFixtureSelection?: unknown;
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
          result: null,
          message: null,
        };
        const jobReply = (call: SuppliedCall) => {
          if (call.method === "jobs" && window.generationFixtureJobs)
            return window.generationFixtureJobs;
          const job = window.generationFixtureJobs?.find(
            (job) => job.jobId === call.request?.job_id
          );
          return call.method === "observe" && job
            ? { events: [{ kind: "status", status: job }], status: job, next: 1 }
            : null;
        };
        const supplied = (call: SuppliedCall | null) => {
          if (!generation || !call) return null;
          const reply = jobReply(call);
          if (reply) return reply;
          if (["create", "refine"].includes(call.method)) {
            window.generationFixtureInput = structuredClone(
              call.method === "refine" ? call.request!.configuration : call.request!.recipe
            );
            window.generationFixtureSelection = structuredClone(call.request!.selection);
            return completed;
          }
          if (call.method === "observe" && call.request?.job_id === completed.jobId)
            return { events: [{ kind: "status", status: completed }], status: completed, next: 1 };
          return null;
        };
        worker.postMessage = (value, options?: Transferable[] | StructuredSerializeOptions) => {
          const call = value?.operation?.service === "generation" ? value.operation.call : null;
          if (call) window.generationCalls.push(call.method);
          const reply = supplied(call);
          if (reply) {
            queueMicrotask(() =>
              worker.dispatchEvent(
                new MessageEvent("message", { data: { id: value.id, value: reply } })
              )
            );
            return;
          }
          if (call && ["create", "refine", "regenerate"].includes(call.method))
            throw new Error("UI scenarios must supply job output, never run real generation.");
          if (Array.isArray(options)) send(value, options);
          else send(value, options);
        };
      }
      return worker;
    },
  });
}
