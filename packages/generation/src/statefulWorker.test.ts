import { expect, it } from "vitest";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { atlasGenerationModules } from "./atlasModules";
import { prepareAtlasGeneration } from "./atlasWorkflow";
import {
  GenerationReceiver,
  type GenerationMessage,
} from "../../../frontend/src/generationTransport";
import {
  inventoryChannel,
  inventoryFeature,
  inventoryLayer,
  statefulInventoryModule,
  statefulInventoryRequest,
} from "./fixtures/statefulModule";

function run(worker: Worker, message: unknown): Promise<GenerationReceiver> {
  return new Promise((resolve, reject) => {
    let receiver: GenerationReceiver | undefined;
    worker.on("error", reject);
    worker.on("message", (entry: GenerationMessage) => {
      if (entry.kind === "failed") reject(new Error(entry.error));
      if (entry.kind === "snapshot") receiver = new GenerationReceiver(entry);
      else if (entry.kind === "samples" || entry.kind === "numerical" || entry.kind === "records")
        receiver!.receive(entry);
      else if (entry.kind === "completed") resolve(receiver!);
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
    const completed = await run(worker, {
      snapshot: prepared.source,
      input: prepared.input,
      operationId: crypto.randomUUID(),
    });
    const snapshot = completed.complete();
    const field = snapshot.world.fields.find((field) => field.layerId === inventoryLayer)!;
    const grid = snapshot.numerical[field.id];
    expect(
      completed.history
        .filter((entry) => entry.path[0] !== "present")
        .map((entry) => entry.ancestry.at(-1)?.id)
    ).toEqual(["Formation", "Recent"]);
    expect(grid.channels[inventoryChannel]).toBeInstanceOf(Float64Array);
    expect(grid.quantities?.[inventoryChannel]).toBe("extensive");
    for (let i = 0; i < grid.active.length; i++)
      if (grid.active[i])
        expect(grid.channels[inventoryChannel][i] / grid.measures[i]).toBeCloseTo(17, 10);
    expect(prepared.input.resolvedFeatures!.selection[inventoryFeature].settings.deposition).toBe(
      2
    );
    expect(snapshot.world.layers[inventoryLayer].name).toBe("Carried inventory");
    expect(source.world.layers[inventoryLayer]).toBeUndefined();
  } finally {
    if (worker) await worker.terminate();
    atlasGenerationModules.unregister(statefulInventoryModule.id);
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
