import { afterEach, expect, it, vi } from "vitest";
import { createWorld } from "./atlasState";
import { cancelGeneration, listJobs, startGeneration } from "./generationJobs";

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
