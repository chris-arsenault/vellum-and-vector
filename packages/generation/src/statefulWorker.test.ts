import { expect, it } from "vitest";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { atlasGenerationModules } from "./atlasModules";
import { prepareAtlasGeneration, type generateAtlas } from "./atlasWorkflow";
import { publishGenerationProducts } from "./publication";
import {
  inventoryChannel,
  inventoryFeature,
  inventoryLayer,
  statefulInventoryModule,
  statefulInventoryRequest,
} from "./fixtures/statefulModule";

type Result = Awaited<ReturnType<typeof generateAtlas>>;
type WorkerMessage = { kind: string; error?: string; result?: Result };

function run(worker: Worker, message: unknown): Promise<Result> {
  return new Promise((resolve, reject) => {
    worker.on("error", reject);
    worker.on("message", (entry: WorkerMessage) => {
      if (entry.kind === "failed") reject(new Error(entry.error));
      if (entry.kind === "completed" && entry.result) resolve(entry.result);
    });
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Worker exited ${code}.`));
    });
    worker.postMessage(message);
  });
}

it("rebinds a reviewed stateful module in a separately bundled worker and publishes its carried output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "atlas-worker-contract-"));
  atlasGenerationModules.register(statefulInventoryModule);
  let worker: Worker | null = null;
  try {
    const outfile = join(directory, "worker.mjs");
    await build({
      entryPoints: [fileURLToPath(new URL("./fixtures/statefulWorker.ts", import.meta.url))],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
    });
    const { source, input } = statefulInventoryRequest();
    const prepared = prepareAtlasGeneration(source, input);
    expect(prepared.diagnostics).toEqual([]);
    worker = new Worker(outfile, { execArgv: [] });
    const completed = await run(worker, { snapshot: prepared.source, input: prepared.input });
    const grid = completed.state.surface;
    expect(completed.state.history.map((entry) => entry.ancestry.at(-1)?.id)).toEqual([
      "Formation",
      "Recent",
    ]);
    expect(grid.channels[inventoryChannel]).toBeInstanceOf(Float64Array);
    expect(grid.quantities?.[inventoryChannel]).toBe("extensive");
    for (let i = 0; i < grid.active.length; i++)
      if (grid.active[i])
        expect(grid.channels[inventoryChannel][i] / grid.measures[i]).toBeCloseTo(17, 10);
    expect(prepared.input.resolvedFeatures!.selection[inventoryFeature].settings.deposition).toBe(
      2
    );
    expect(completed.state.physical).toBeUndefined();
    publishGenerationProducts(completed.state, "separate-worker-contract");
    expect(completed.state.domain.world.layers[inventoryLayer].name).toBe("Carried inventory");
    expect(
      completed.state.domain.world.fields.some((field) => field.layerId === inventoryLayer)
    ).toBe(true);
    expect(source.world.layers[inventoryLayer]).toBeUndefined();
  } finally {
    if (worker) await worker.terminate();
    atlasGenerationModules.unregister(statefulInventoryModule.id);
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
