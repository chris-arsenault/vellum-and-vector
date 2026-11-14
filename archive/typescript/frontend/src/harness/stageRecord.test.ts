import { afterEach, expect, it, vi } from "vitest";
import { generateBand, sampleCoverage } from "@atlas/domain";
import * as places from "../../../packages/generation/src/poi/poiAudit";
import * as catalogue from "../../../packages/generation/src/poi/catalogueExercise";
import type { GenerationState } from "../../../packages/generation/src/process";
import { stageRecorder, type StageEvent } from "./stageRecord";
import type { NativeMemory } from "./harnessGeneration";

afterEach(() => vi.restoreAllMocks());

it("runs the exhaustive place audit only when explicitly requested", () => {
  const audit = vi.spyOn(places, "auditPlaces").mockReturnValue({}),
    exercise = vi.spyOn(catalogue, "exerciseCatalogue").mockReturnValue({}),
    active = generateBand(sampleCoverage(1), "uint8", "active", () => 1),
    state = { surface: { channels: {}, active } } as GenerationState;
  try {
    stageRecorder().observers.inspect!(["names"], "atlas.names", state);
    expect(audit).not.toHaveBeenCalled();
    expect(exercise).not.toHaveBeenCalled();
    stageRecorder(undefined, true).observers.inspect!(["names"], "atlas.names", state);
    expect(audit).toHaveBeenCalledWith(state);
    expect(exercise).toHaveBeenCalledWith(state);
  } finally {
    active.release();
  }
});

it("publishes boundary evidence immediately, including a failed step without completion", () => {
  const events: StageEvent[] = [],
    recorder = stageRecorder((event) => events.push(event));
  recorder.observers.progress!(["epoch-2", "erosion"], 0, "Starting erosion");
  recorder.observers.progress!(["epoch-2", "erosion"], 0.5, "Routing sediment");
  recorder.observers.diagnostic!({
    process: "erosion",
    epochs: [],
    code: "failed",
    severity: "error",
    outcome: "failed",
    invocation: null,
    resource: null,
    message: "Explicit supplied failure",
    stack: "supplied stack",
  });
  expect(events.map((event) => event.kind)).toEqual(["start", "progress", "diagnostic"]);
  expect(events[0]).toMatchObject({ path: "epoch-2/erosion", fraction: 0 });
  expect(events[2]).toMatchObject({ diagnostic: recorder.diagnostics[0] });
  expect(recorder.stages).toEqual([]);
  for (const event of events) {
    expect(event.pid).toBe(process.pid);
    expect(Number.isFinite(Date.parse(event.timestamp))).toBe(true);
    expect(event.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
    expect(event.memory.rss).toBeGreaterThan(0);
    expect(event.cpuMicroseconds.user).toBeGreaterThanOrEqual(0);
    expect(event.cpuMicroseconds.system).toBeGreaterThanOrEqual(0);
  }
});

it("publishes completed and skipped stages without changing their stored records", () => {
  const events: StageEvent[] = [],
    recorder = stageRecorder((event) => events.push(event)),
    active = generateBand(sampleCoverage(3), "uint8", "active", (cell) => (cell === 1 ? 0 : 1)),
    state = { surface: { channels: {}, active } } as GenerationState;
  recorder.observers.progress!(["formation"], 0, "Starting foundation");
  recorder.observers.inspect!(["formation"], "foundation", state);
  recorder.observers.progress!(["optional"], 1, "Skipped absent");
  expect(events.map((event) => event.kind)).toEqual(["start", "complete", "skipped"]);
  expect(events[1]).toMatchObject({
    stage: { process: "foundation", outcome: "completed", surfaceCells: 3, activeCells: 2 },
  });
  expect(recorder.stages[1]).toMatchObject({ process: "absent", outcome: "skipped" });
  active.release();
});

it("does not sample process resources when no event callback is installed", () => {
  const memory = vi.spyOn(process, "memoryUsage"),
    cpu = vi.spyOn(process, "cpuUsage"),
    recorder = stageRecorder(),
    nativeMemory = vi.fn<() => NativeMemory>();
  recorder.observers.nativeMemory!(nativeMemory);
  recorder.observers.progress!(["formation"], 0, "Starting foundation");
  expect(memory).not.toHaveBeenCalled();
  expect(cpu).not.toHaveBeenCalled();
  expect(nativeMemory).not.toHaveBeenCalled();
});

it("samples current native owners at boundaries and drops the reader when its scope ends", () => {
  const events: StageEvent[] = [],
    recorder = stageRecorder((event) => events.push(event)),
    sqlite = { wasmBytes: 1024, allocatedBytes: 512, peakAllocatedBytes: 768 };
  let geosWasmBytes = 4096;
  const read = vi.fn(() => ({ geosWasmBytes, scratchSqlite: sqlite, catalogSqlite: sqlite }));
  recorder.observers.nativeMemory!(read);
  recorder.observers.progress!(["features"], 0, "Starting features");
  geosWasmBytes = 8192;
  recorder.observers.progress!(["features"], 0.5, "Extracting faults");
  recorder.observers.nativeMemory!(undefined);
  recorder.observers.progress!(["features"], 1, "Completed features");
  expect(events.map((event) => event.nativeMemory?.geosWasmBytes)).toEqual([4096, 8192, undefined]);
  expect(events[0].nativeMemory?.scratchSqlite).toEqual(sqlite);
  expect(events[0].memory.rss).toBeGreaterThan(0);
  expect(read).toHaveBeenCalledTimes(2);
});
