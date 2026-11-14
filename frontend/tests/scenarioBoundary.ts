declare global {
  interface Window {
    atlasScenario: { rendering: boolean; generation: boolean };
    generationFixtureInput?: unknown;
    generationCalls: string[];
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
export function installScenarioBoundary({
  rendering,
  generation = false,
}: {
  rendering: boolean;
  generation?: boolean;
}) {
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
        const supplied = (
          call: { method: string; request?: { recipe?: unknown; job_id?: string } } | null
        ) => {
          if (!generation || !call) return null;
          if (call.method === "create") {
            window.generationFixtureInput = structuredClone(call.request?.recipe);
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
