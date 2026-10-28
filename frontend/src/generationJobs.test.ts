import { fixtureWorld, fixtureState, readFeature } from "./testSupport/workspaceFixture";
import { afterEach, expect, it, vi } from "vitest";
import { cancelGeneration, listJobs, startGeneration, generationSnapshot } from "./generationJobs";
import {
  createAdaptiveField,
  createAdaptiveTopology,
  generateBand,
  putChannel,
} from "@atlas/domain";
import { atlasPublicationDefinitions, type GenerationDiagnostic } from "@atlas/generation";
import { mapEditingFixture } from "./mapEditingFixture";
vi.mock("./atlasWorkspace", async () => {
  const { fixtureState: current } = await import("./testSupport/workspaceFixture");
  const { prepareAtlasGeneration } = await import("@atlas/generation");
  return {
    readEditorWorld: async (id: string) => current(id).snapshot.world,
    atlasWorkspace: async () => ({
      connect: async () => {},
      generationSetup: async (
        id: string,
        input: import("@atlas/generation").AtlasGenerationInput
      ) => prepareAtlasGeneration(current(id).snapshot, input),
    }),
    rememberWorld: vi.fn(),
  };
});

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

it("rejects overlapping generation before creating a worker or job", async () => {
  const f = await mapEditingFixture();
  await f.command("putMapFeature", {
    areaId: f.child,
    feature: {
      ...(await readFeature(f.id, f.town, f.child)),
      geometry: { type: "Point", coordinates: [550, 450] },
    },
  });
  const worker = vi.fn();
  vi.stubGlobal("Worker", worker);
  await expect(
    startGeneration(f.id, {
      areaId: f.child,
      quality: "draft",
      seed: 17,
      domains: ["physical"],
      expectedVersion: f.current().world.version,
      operationId: crypto.randomUUID(),
    })
  ).rejects.toThrow(/overlaps/);
  expect(worker).not.toHaveBeenCalled();
  expect(listJobs(f.id)).toEqual([]);
});

it.each(["completed", "failed"])(
  "retains streamed diagnostics when generation is %s",
  async (status) => {
    vi.stubGlobal("Worker", TestWorker);
    const world = fixtureWorld({
      name: "Recoverable errors",
      seed: 42,
      width: 10000,
      height: 10000,
    });
    const domain = fixtureState(world.id).snapshot;
    const input = {
      areaId: domain.scope.areaId,
      domains: ["physical"],
      quality: "draft",
      seed: 42,
    };
    await startGeneration(world.id, {
      ...input,
      expectedVersion: world.version,
      operationId: crypto.randomUUID(),
    });
    const diagnostic: GenerationDiagnostic = {
      code: "process_failed",
      message: "Contour omitted",
      severity: "error",
      invocation: "canonry.features",
      resource: null,
      process: "canonry.features",
      epochs: [],
      outcome: "omitted",
      stack: "Error: Contour omitted",
    };
    const worker = TestWorker.latest;
    worker.onmessage!({ data: { kind: "diagnostic", diagnostic } });
    await vi.waitFor(() => expect(listJobs(world.id)[0].diagnostics).toContainEqual(diagnostic));
    expect(listJobs(world.id)[0].diagnostics).toContainEqual(diagnostic);
    expect(listJobs(world.id)[0].status).toBe("running");
    if (status === "completed") {
      worker.onmessage!({ data: { kind: "completed" } });
    } else {
      worker.onmessage!({
        data: { kind: "failed", error: "Unrecoverable failure", diagnostics: [diagnostic] },
      });
    }
    await vi.waitFor(() => expect(listJobs(world.id)[0].status).toBe(status));
    const job = listJobs(world.id)[0];
    expect(job.status).toBe(status);
    expect(job.error).toBe(status === "completed" ? null : "Unrecoverable failure");
    expect(job.diagnostics?.filter((entry) => entry.code === "process_failed")).toEqual([
      diagnostic,
    ]);
  }
);

it("retains the active stage and error when a worker fails", async () => {
  vi.stubGlobal("Worker", TestWorker);
  const world = fixtureWorld({
    name: "Failure diagnostics",
    seed: 42,
    width: 10000,
    height: 10000,
  });
  const job = await startGeneration(world.id, {
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
  await vi.waitFor(() =>
    expect(listJobs(world.id)[0].stage).toBe("Building territory for Polity 1")
  );
  worker.onerror!({ message: "Worker exhausted memory" });
  const failed = listJobs(world.id)[0];
  expect(failed.status).toBe("failed");
  expect(failed.stage).toContain("Building territory for Polity 1");
  expect(failed.error).toBe("Worker exhausted memory");
  expect(worker.terminate).toHaveBeenCalledOnce();
  cancelGeneration(job.id);
});

it("starts generation with operative political capacity without a compatibility warning", async () => {
  vi.stubGlobal("Worker", TestWorker);
  const world = fixtureWorld({ name: "History warning", seed: 42, width: 10000, height: 10000 });
  world.humanEras![0].politicalCapacity = 2;
  const job = await startGeneration(world.id, {
    areaId: Object.keys(world.areas)[0],
    domains: ["physical", "cultural"],
    quality: "draft",
    seed: 42,
    expectedVersion: world.version,
    operationId: crypto.randomUUID(),
  });
  expect(TestWorker.latest.postMessage).toHaveBeenCalledOnce();
  expect(listJobs(world.id)[0].status).toBe("running");
  expect(listJobs(world.id)[0].diagnostics).not.toContainEqual(
    expect.objectContaining({ severity: "warning" })
  );
  cancelGeneration(job.id);
});

it("publishes adaptive world quantities in their geographic layers without rasterizing them", async () => {
  const world = fixtureWorld({ name: "World fields", seed: 42, width: 10000, height: 10000 });
  const domain = fixtureState(world.id).snapshot;
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
    putChannel(
      grid,
      channel,
      unit,
      generateBand(grid.coverage, "float64", channel, () => 1)
    );
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
