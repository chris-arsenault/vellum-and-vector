import { beforeEach, expect, it, vi } from "vitest";
import { startCpuProfile } from "./cpuProfile";

const io = vi.hoisted(() => ({
  construct: vi.fn(),
  connect: vi.fn(),
  post: vi.fn(),
  disconnect: vi.fn(),
  write: vi.fn(),
}));
vi.mock("node:inspector/promises", () => ({
  Session: class {
    constructor() {
      io.construct();
    }
    connect = io.connect;
    post = io.post;
    disconnect = io.disconnect;
  },
}));
vi.mock("node:fs", () => ({ writeFileSync: io.write }));

beforeEach(() => {
  vi.resetAllMocks();
  io.post.mockResolvedValue({ profile: { nodes: [], samples: [], timeDeltas: [] } });
});

it("does not attach an inspector unless profiling is requested", async () => {
  const stop = await startCpuProfile("unused.cpuprofile", false);
  await stop();
  expect(io.construct).not.toHaveBeenCalled();
  expect(io.write).not.toHaveBeenCalled();
});

it("records CPU samples and saves the standard profile before disconnecting", async () => {
  const stop = await startCpuProfile("run.cpuprofile", true);
  expect(io.post.mock.calls).toEqual([
    ["Profiler.enable"],
    ["Profiler.setSamplingInterval", { interval: 10_000 }],
    ["Profiler.start"],
  ]);
  expect(io.disconnect).not.toHaveBeenCalled();
  await stop();
  expect(io.post).toHaveBeenLastCalledWith("Profiler.stop");
  expect(io.write).toHaveBeenCalledWith("run.cpuprofile", expect.any(String));
  expect(JSON.parse(io.write.mock.calls[0][1])).toEqual({
    nodes: [],
    samples: [],
    timeDeltas: [],
  });
  expect(io.disconnect).toHaveBeenCalledOnce();
});

it("disconnects if profiling cannot start", async () => {
  io.post.mockRejectedValueOnce(new Error("inspector unavailable"));
  await expect(startCpuProfile("run.cpuprofile", true)).rejects.toThrow("inspector unavailable");
  expect(io.disconnect).toHaveBeenCalledOnce();
  expect(io.write).not.toHaveBeenCalled();
});

it("disconnects even if the completed profile cannot be written", async () => {
  const stop = await startCpuProfile("run.cpuprofile", true);
  io.write.mockImplementationOnce(() => {
    throw new Error("write failed");
  });
  await expect(stop()).rejects.toThrow("write failed");
  expect(io.disconnect).toHaveBeenCalledOnce();
});
