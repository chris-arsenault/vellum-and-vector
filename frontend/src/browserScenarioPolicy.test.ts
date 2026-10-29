import { afterEach, expect, it, vi } from "vitest";
import { assertGenerationScenario, installScenarioBoundary } from "../tests/scenarioBoundary";

class WorkerStub extends EventTarget {
  messages: unknown[] = [];
  postMessage(value: unknown) {
    this.messages.push(value);
  }
}
function scenario(rendering = false, generation = false) {
  vi.stubGlobal("window", { Worker: WorkerStub });
  installScenarioBoundary({ rendering, generation });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("preserves numerical requests and raster metadata needed by overlay controls", () => {
  scenario();
  const worker = new window.Worker("workspace.worker.js") as unknown as WorkerStub;
  const source = { id: 1, operation: { kind: "generationSource" } };
  const metadata = { id: 2, operation: { kind: "readRasters" } };
  worker.postMessage(source);
  worker.postMessage(metadata);
  expect(worker.messages).toEqual([source, metadata]);
});

it("requires an explicit observed boundary and never permits a real generation worker", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  scenario();
  expect(() => assertGenerationScenario()).toThrow("openFixtureMap");
  expect(() => new window.Worker("raster.worker.js")).toThrow("@rendering");
  scenario(true, true);
  expect(() => assertGenerationScenario()).not.toThrow();
  expect(() => new window.Worker("raster.worker.js")).not.toThrow();
  expect(() => new window.Worker("generation.worker.js")).toThrow("never real generation");
  const worker = new window.Worker("workspace.worker.js") as unknown as WorkerStub;
  worker.postMessage({ id: 1, operation: { kind: "readRasters" } });
  expect(worker.messages).toHaveLength(1);
});
