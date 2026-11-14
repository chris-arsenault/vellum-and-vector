import { beforeEach, expect, it, vi } from "vitest";
import { createField } from "../../../packages/generation/src/world/field";
import { createWorldMesh } from "../../../packages/generation/src/world/worldMesh";
import { physicalContext } from "../../../packages/generation/src/world/context";
import { physicalProfile } from "../../../packages/generation/src/world/profile";
import { defineProcess } from "../../../packages/generation/src/processes/groundProcess";
import { nativeOperation } from "../../../packages/generation/src/processes/processRunner";
import { runNativeStep } from "../../../packages/generation/src/world/physicalSteps";
import { harnessOptions, runHarness, write as writeReport } from "./harness";

const io = vi.hoisted(() => ({
  write: vi.fn(),
  opened: [] as { path: string; chunks: string[] }[],
  closeFile: vi.fn(),
  closed: [] as ReturnType<typeof vi.fn>[],
  generate: vi.fn(),
  refine: vi.fn(),
  startProfile: vi.fn(),
  stopProfile: vi.fn(),
  stopTrace: vi.fn(() => ({
    steps: [],
    probes: [],
    columns: [],
    rock: [],
    story: null,
    failedSnapshot: undefined,
  })),
  world: { kind: "world", name: "world", worldId: "w", root: "root", position: [0, 0] },
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  mkdirSync: vi.fn(),
  writeFileSync: io.write,
  openSync: (path: string) => io.opened.push({ path, chunks: [] }) - 1,
  writeSync: (file: number, bytes: Buffer, offset: number, length: number) => {
    io.opened[file].chunks.push(bytes.subarray(offset, offset + length).toString());
    return length;
  },
  closeSync: (file: number) => {
    io.closeFile(file);
    const output = io.opened[file];
    io.write(output.path, output.chunks.join(""));
  },
}));
vi.mock("./harnessWorkspace", () => ({
  harnessRoot: "/probe-output",
  checkpointDirectory: (name: string) => name,
  copyCheckpoint: vi.fn(),
  removeCheckpoint: vi.fn(),
  currentCommit: () => "probe",
  readCheckpoint: (name: string) => (name === "world" ? io.world : undefined),
  openHarnessWorkspace: async () => {
    const close = vi.fn();
    io.closed.push(close);
    return { save: vi.fn(), close };
  },
}));
vi.mock("./harnessGeneration", () => ({ generateWorld: io.generate, refineRegion: io.refine }));
vi.mock("./cpuProfile", () => ({ startCpuProfile: io.startProfile }));
vi.mock("../generationDraft", () => ({
  newGenerationDraft: () => ({ recipe: {}, width: 100, height: 100 }),
}));
vi.mock("./stageRecord", () => ({
  stageRecorder: () => ({ diagnostics: [], observers: {}, highestLand: () => [0, 0] }),
}));
vi.mock("./reliefTrace", () => ({
  traceRelief: () => io.stopTrace,
}));
vi.mock("./mapReport", () => ({
  openTerrain: async () => ({
    raster: { field: { scope: { resolution: 1 } } },
    rasters: [],
    world: { areas: { root: { footprint: {} } } },
    geography: {},
    close: vi.fn(),
  }),
  channelRanges: vi.fn(() => ({})),
  fieldInventory: vi.fn(),
  scaleReport: vi.fn(),
  tileTiming: vi.fn(),
}));
vi.mock("./featureReport", () => ({ mapFeatures: vi.fn(), featureReport: vi.fn() }));
vi.mock("./reliefReport", () => ({ reliefReport: vi.fn(() => ({})) }));
vi.mock("../testSupport/regionalOverview", () => ({
  rasterOverview: vi.fn(),
  rasterRelief: vi.fn(),
}));
vi.mock("./quickTerrain", () => ({ quickTerrain: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  io.generate.mockReset();
  io.refine.mockReset();
  io.startProfile.mockResolvedValue(io.stopProfile);
  io.closed.length = 0;
  io.opened.length = 0;
});

it("writes ordered observations without serializing the enclosing array", () => {
  const observations = [
    { event: "before", material: "shale" },
    { event: "after", material: "basalt" },
  ];
  Object.defineProperty(observations, "toJSON", {
    value: () => {
      throw new Error("whole history serialization");
    },
  });
  writeReport("/probe-output", "ground", observations);
  expect(JSON.parse(io.write.mock.calls[0][1])).toEqual(observations);
  expect(io.closeFile).toHaveBeenCalledOnce();
});

it("closes an observation file if an individual record cannot serialize", () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;
  expect(() => writeReport("/probe-output", "ground", [circular])).toThrow();
  expect(io.closeFile).toHaveBeenCalledOnce();
});

it("writes successful world observations without serializing an absent failure snapshot", async () => {
  io.generate.mockResolvedValue({ worldId: "w", root: "root" });
  await runHarness(
    harnessOptions({ HARNESS_FRESH: "world", HARNESS_WORLD_ONLY: "1", HARNESS_CPU_PROFILE: "1" })
  );
  expect(io.startProfile).toHaveBeenCalledWith(expect.stringMatching(/run\.cpuprofile$/), true);
  expect(io.stopProfile).toHaveBeenCalledOnce();
  expect(io.stopTrace).toHaveBeenCalledWith(undefined);
  expect(io.write.mock.calls.some(([path]) => String(path).endsWith("/world-trace.json"))).toBe(
    true
  );
  expect(
    io.write.mock.calls.some(([path]) => String(path).endsWith("/world-failedSnapshot.json"))
  ).toBe(false);
  expect(io.write.mock.calls.every(([, contents]) => contents !== undefined)).toBe(true);
});

it.each(["world", "region", "quick-region"])(
  "attaches %s point inspection and saves partial samples when its generation operation fails",
  async (kind) => {
    const map = createField(createWorldMesh([-500, -500, 500, 500], 16, 0)),
      at = [map.mesh.origin[0] + map.mesh.x(0), map.mesh.origin[1] + map.mesh.y(0)],
      probe = defineProcess({
        id: "failure-probe",
        statement: "Tests the harness lifecycle.",
        reads: [],
        asks: [],
        moves: [],
        settings: {},
        prepare: () => ({}),
        execute() {
          throw new Error("generation operation failed");
        },
      }),
      execute = () =>
        runNativeStep(map, physicalContext(1, 0, map.scale.resolve(physicalProfile)), [
          "probe-step",
          0,
          nativeOperation("probe-step", [probe]),
          [probe],
        ]);
    io.generate.mockImplementation(execute);
    io.refine.mockImplementation(execute);
    const options = harnessOptions({
      HARNESS_PROCESS_AT: at.join(","),
      HARNESS_PROCESS_BANDS: "Runoff,Quickening",
      HARNESS_FRESH: kind === "world" ? "world" : "region",
      HARNESS_WORLD_ONLY: kind === "world" ? "1" : "",
      HARNESS_WORLD_SIZE: "2000000,1500000",
      HARNESS_QUICK: kind === "quick-region" ? "1" : "",
      HARNESS_CPU_PROFILE: "1",
    });
    await expect(runHarness(options)).rejects.toThrow("generation operation failed");
    expect(io.stopProfile).toHaveBeenCalledOnce();
    if (kind === "world") expect(io.stopTrace).toHaveBeenCalledWith("generation operation failed");
    if (kind === "world") {
      expect(io.generate.mock.calls[0][1]).toMatchObject({ width: 2_000_000, height: 1_500_000 });
      for (const artifact of ["world-input", "world-run", "world-trace", "world-columns"])
        expect(
          io.write.mock.calls.some(([name]) => String(name).endsWith(`/${artifact}.json`))
        ).toBe(true);
    }
    const failure = io.write.mock.calls.find(([name]) => String(name).endsWith("/failure.json"));
    expect(JSON.parse(failure![1])).toMatchObject({ message: "generation operation failed" });
    const written = io.write.mock.calls.find(([name]) =>
      String(name).endsWith(`/${kind}-processes.json`)
    );
    expect(written).toBeDefined();
    expect(JSON.parse(written![1])).toMatchObject([
      {
        step: "probe-step",
        processes: ["failure-probe"],
        phase: "before",
        fields: { Runoff: 0, Quickening: 0 },
      },
    ]);
    for (const close of io.closed) expect(close).toHaveBeenCalledOnce();
    // A later execution cannot append to the stopped probe or publish it again.
    const writes = io.write.mock.calls.length;
    expect(execute).toThrow("generation operation failed");
    expect(io.write).toHaveBeenCalledTimes(writes);
  }
);
