import { expect, it } from "vitest";
import {
  attachGrid,
  Band,
  detachGrid,
  generateBand,
  putChannel,
  type BlockCache,
} from "@atlas/domain";
import { blockCacheFixture } from "./blockCacheFixture";
import { MapRunner } from "../../generation/src/mapRunner";
import { MapProcessRegistry, type MapProcess } from "../../generation/src/process";
import { landscape, configuration, invoke, options } from "../../generation/src/mapFixtures";
function runnerProcess(
  id: string,
  applyPass: Extract<MapProcess["behavior"], { kind: "model-pass" }>["applyPass"],
  requires: string[] = []
): MapProcess {
  return {
    contract: { id, version: "1", parameters: {}, requires, produces: [id], invalidates: [] },
    behavior: { kind: "model-pass", applyPass },
    validate: () => [],
  };
}
function lifetimeProcesses(): MapProcess[] {
  let scratch: Band;
  return [
    runnerProcess("retained", (state) => {
      const coverage = state.surface.coverage;
      scratch = coverage.scratch("float64", "scratch", 1000);
      scratch.set(0, 7);
      const values = coverage.scratch("float64", "output").fill(9);
      putChannel(state.surface, "elevation", "metre", values);
    }),
    runnerProcess(
      "checked",
      (state) => {
        expect(() => scratch.get(0)).toThrow(/released/);
        expect(state.surface.channels.elevation.get(0)).toBe(9);
      },
      ["retained"]
    ),
    ...replacementProcesses(),
  ];
}
function replacementProcesses() {
  let previous: Band;
  return [
    runnerProcess(
      "replaced",
      (state) => {
        previous = state.surface.channels.elevation;
        putChannel(
          state.surface,
          "elevation",
          "metre",
          generateBand(state.surface.coverage, "float64", "next", (i) => previous.get(i) + 1)
        );
      },
      ["checked"]
    ),
    runnerProcess(
      "released",
      (state) => {
        expect(() => previous.get(0)).toThrow(/released/);
        expect(state.surface.channels.elevation.get(0)).toBe(10);
      },
      ["replaced"]
    ),
  ];
}
/** The landscape fixture with its surface grid paging through `cache`. */
function onCache(state: ReturnType<typeof landscape>, cache: BlockCache) {
  state.surface = attachGrid(detachGrid(state.surface), cache) as typeof state.surface;
  state.cache = cache;
  return state;
}
it("carries published evicting outputs across runner stages and releases successful scratch", async () => {
  const fixture = blockCacheFixture(),
    processes = lifetimeProcesses();
  try {
    const registry = new MapProcessRegistry();
    processes.forEach((process) => registry.register(process));
    const result = await new MapRunner(
      configuration(processes.map((process) => invoke(process))),
      registry
    ).run(onCache(landscape(), fixture.cache), { ...options, cache: fixture.cache });
    expect(result.state.facts.has("checked")).toBe(true);
    expect(result.state.facts.has("released")).toBe(true);
    expect(result.state.surface.channels.elevation.get(0)).toBe(10);
  } finally {
    fixture.close();
  }
});
it("releases scratch when a process fails and stops the runner", async () => {
  const fixture = blockCacheFixture(),
    state = onCache(landscape(), fixture.cache),
    registry = new MapProcessRegistry();
  let scratch: Band | undefined;
  const failed = runnerProcess("failed", (current) => {
    scratch = current.surface.coverage.scratch("float64", "failure", 1000);
    scratch.set(0, 11);
    throw new Error("Deliberate process failure");
  });
  registry.register(failed);
  try {
    await expect(
      new MapRunner(configuration([invoke(failed)]), registry).run(state, {
        ...options,
        cache: fixture.cache,
      })
    ).rejects.toThrow("Deliberate process failure");
    expect(scratch).toBeDefined();
    expect(() => scratch!.get(0)).toThrow(/released/);
    expect(state.facts.has("failed")).toBe(false);
  } finally {
    fixture.close();
  }
});
