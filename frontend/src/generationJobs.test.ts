import { afterEach, expect, it, vi } from "vitest";
import { createWorld, session } from "./atlasState";
import { cancelGeneration, listJobs, startGeneration, generationSnapshot } from "./generationJobs";
import { createAdaptiveField, createAdaptiveTopology, putChannel } from "@atlas/domain";
import { atlasPublicationDefinitions } from "@atlas/generation";

class TestWorker {
  static latest: TestWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    TestWorker.latest = this;
  }
}

afterEach(() => vi.unstubAllGlobals());

it("retains the active stage and error when a worker fails", () => {
  vi.stubGlobal("Worker", TestWorker);
  const world = createWorld({ name: "Failure diagnostics", seed: 42, width: 10000, height: 10000 });
  const job = startGeneration(world.id, {
    areaId: Object.keys(world.areas)[0],
    domains: ["physical"],
    quality: "draft",
    seed: 42,
    expectedVersion: world.version,
    operationId: crypto.randomUUID(),
  });
  const worker = TestWorker.latest;
  worker.onmessage!({
    data: {
      kind: "progress",
      path: ["human.politics"],
      fraction: 0.9,
      message: "Building territory for Polity 1",
    },
  });
  expect(listJobs(world.id)[0].stage).toBe("Building territory for Polity 1");
  worker.onerror!({ message: "Worker exhausted memory" });
  const failed = listJobs(world.id)[0];
  expect(failed.status).toBe("failed");
  expect(failed.stage).toContain("Building territory for Polity 1");
  expect(failed.error).toBe("Worker exhausted memory");
  expect(worker.terminate).toHaveBeenCalledOnce();
  cancelGeneration(job.id);
});

it("starts generation when legacy history produces a nonblocking compatibility warning", () => {
  vi.stubGlobal("Worker", TestWorker);
  const world = createWorld({ name: "History warning", seed: 42, width: 10000, height: 10000 });
  world.humanEras![0].politicalCapacity = 2;
  const job = startGeneration(world.id, {
    areaId: Object.keys(world.areas)[0],
    domains: ["physical", "cultural"],
    quality: "draft",
    seed: 42,
    expectedVersion: world.version,
    operationId: crypto.randomUUID(),
  });
  expect(TestWorker.latest.postMessage).toHaveBeenCalledOnce();
  expect(listJobs(world.id)[0].status).toBe("running");
  expect(listJobs(world.id)[0].diagnostics).toContainEqual(
    expect.objectContaining({ severity: "warning" })
  );
  cancelGeneration(job.id);
});

it("publishes adaptive world quantities in their geographic layers without rasterizing them", () => {
  const world = createWorld({ name: "World fields", seed: 42, width: 10000, height: 10000 });
  const domain = session(world.id).snapshot;
  const topology = createAdaptiveTopology([0, 0, 10000, 10000], {
    maximumSize: 2500,
    minimumSize: 2500,
  });
  const grid = createAdaptiveField("world-field", domain.scope, topology);
  for (const [channel, unit] of [
    ["elevation", "metre"],
    ["slope", "gradient"],
    ["riverWidth", "metre"],
    ["riverDepth", "metre"],
    ["catchmentArea", "square-metre"],
    ["biome", "category"],
    ["treeCover", "ratio"],
    ["oilCarbon", "kg-carbon/square-metre"],
  ])
    putChannel(grid, channel, unit, new Float64Array(grid.active.length).fill(1));
  const output = generationSnapshot(
    {
      kind: "final",
      configurationHash: "world-fields",
      ancestry: [],
      state: {
        domain,
        surface: grid,
        facts: new Set(["elevation"]),
        history: [],
        publications: atlasPublicationDefinitions(
          { areaId: domain.scope.areaId, seed: 42, quality: "draft", domains: ["physical"] },
          world
        ),
      },
    },
    { areaId: domain.scope.areaId, seed: 42, quality: "draft", domains: ["physical"] },
    crypto.randomUUID()
  );
  const rivers = output.world.fields.find((field) => field.layerId === "rivers")!;
  expect(rivers.channels).toEqual(
    expect.arrayContaining(["riverWidth", "riverDepth", "catchmentArea"])
  );
  expect(output.world.fields.find((field) => field.layerId === "geology")!.channels).toContain(
    "slope"
  );
  expect(output.numerical[rivers.id].topology).toBe(topology);
  expect(output.numerical[rivers.id].channels.riverWidth).toBe(grid.channels.riverWidth);
  const ecology = output.world.fields.find((field) => field.layerId === "ecology")!;
  expect(ecology.channels).toEqual(expect.arrayContaining(["biome", "treeCover", "oilCarbon"]));
  expect(output.numerical[ecology.id].units.oilCarbon).toBe("kg-carbon/square-metre");
});
