declare global {
  interface Window {
    atlasScenario: { rendering: boolean; generation: boolean };
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
      return Reflect.construct(target, args);
    },
  });
}
