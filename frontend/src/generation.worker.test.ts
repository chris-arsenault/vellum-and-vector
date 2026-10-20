import { afterEach, expect, it, vi } from "vitest";

const generateAtlas = vi.hoisted(() => vi.fn());
vi.mock("@atlas/generation", () => ({generateAtlas}));
afterEach(() => vi.unstubAllGlobals());

it("delivers shared completed buffers once without detaching the editor's input", async () => {
  const editorValues = new Float64Array([10, 20, 30]),
    workerValues = editorValues.slice(),
    result = {state: {surface: {channels: {elevation: workerValues},
      overlays: [{grid: {channels: {bedrock: workerValues}}}]} }},
    delivered: {kind: string; result?: typeof result}[] = [],
    worker: {onmessage?: (event: unknown) => Promise<void>; postMessage: (message: unknown, options?: {transfer: ArrayBuffer[]}) => void} = {
      postMessage(message, options) {delivered.push(structuredClone(message, options) as typeof delivered[number]);},
    };
  generateAtlas.mockResolvedValue(result);
  vi.stubGlobal("self", worker);
  await import("./generation.worker");
  await worker.onmessage!({data: {snapshot: {}, input: {}}});
  const completed = delivered.find((message) => message.kind === "completed")!.result!;
  expect(completed.state.surface.channels.elevation).toEqual(editorValues);
  expect(completed.state.surface.overlays[0].grid.channels.bedrock).toBe(completed.state.surface.channels.elevation);
  expect(workerValues.byteLength).toBe(0);
  expect(editorValues.byteLength).toBe(24);
});
