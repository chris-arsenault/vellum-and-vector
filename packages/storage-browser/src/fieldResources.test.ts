import { afterEach, describe, expect, it } from "vitest";
import {
  adaptiveLeafAt,
  Band,
  createAdaptiveField,
  createAdaptiveTopology,
  createGrid,
  generateBand,
  gridSchema,
  putChannel,
  cloneSnapshot,
  readRange,
  sameValue,
  restoreMappedEdits,
  rectangle,
  type Grid,
  type SpatialScope,
} from "@atlas/domain";
import { writeFieldChannels, writeFieldLayout } from "./fieldResources";
import { FieldInputCache, FieldWorkingSet } from "./fieldWorkingSet";
import { resourceCategories } from "./fieldSummaries";
import { blockCacheFixture } from "./blockCacheFixture";
import type { BinaryStore } from "./opfsStore";
import { ZarrResources } from "./zarrResources";
import { landscape } from "../../generation/src/mapFixtures";

const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup())
);
/** Two float64 blocks resident: loading a field of several blocks evicts and reloads. */
const blockBudget = 262_144;
function fixture() {
  const blocks = blockCacheFixture(blockBudget);
  cleanups.push(() => blocks.close());
  const values = new Map<string, Uint8Array>(),
    reads: string[] = [];
  const fault = { write: null as string | null };
  const store: BinaryStore = {
    async get(key) {
      reads.push(key);
      return values.get(key)?.slice();
    },
    async set(key, bytes) {
      if (fault.write && key.includes(fault.write)) {
        fault.write = null;
        throw new Error("Simulated storage write failure");
      }
      values.set(key, bytes.slice());
    },
    async deletePrefix(prefix) {
      for (const key of values.keys()) if (key.startsWith(`${prefix}/`)) values.delete(key);
    },
    async snapshot(keys) {
      const files = new Map(keys.map((key) => [key, values.get(key)]));
      return {
        read(key) {
          reads.push(key);
          return files.get(key)?.slice();
        },
        close() {
          files.clear();
        },
      };
    },
  };
  const resources = new ZarrResources(store, 262_144),
    working = new FieldWorkingSet(resources, blocks.cache);
  cleanups.push(() => working.close());
  return { blocks, values, reads, resources, working, fault };
}
function scope(): SpatialScope {
  return {
    worldId: "world",
    areaId: "root",
    spaceId: "world",
    crsId: "world:metres",
    revision: 1,
    time: "present",
    resolution: 1,
    footprint: rectangle([0, 0, 1000, 1000]),
  };
}
function channels(grid: Grid) {
  putChannel(
    grid,
    "height",
    "metre",
    generateBand(grid.coverage, "float64", "height", (i) => Math.sin(i / 17) * 200)
  );
  putChannel(
    grid,
    "water",
    "category",
    generateBand(grid.coverage, "float64", "water", (i) => i % 3),
    "category"
  );
  grid.ocean = rectangle([0, 0, 50, 1000]);
}
const bandNames = (topology: object) =>
  Object.entries(topology)
    .filter(([, value]) => value instanceof Band)
    .map(([name]) => name);
it("publishes channel bands over different offsets of one source buffer", async () => {
  const f = fixture(),
    grid = createGrid("offsets", scope(), 3, 3);
  const values = Float64Array.from({ length: 18 }, (_, i) => i + 0.5),
    over = (start: number, end: number, name: string) =>
      Band.over(
        values.subarray(start, end),
        { name, type: "float64", lifetime: "run" },
        grid.coverage.cache
      );
  putChannel(grid, "first", "metre", over(0, 9, "first"));
  putChannel(grid, "second", "metre", over(9, 18, "second"));
  const shared = await writeFieldLayout(f.resources, grid, "offset-layout", 1e-6);
  await writeFieldChannels(f.resources, grid, "offset-channels", shared);
  const input = await f.working.load("offset-channels", ["first", "second"], shared.geography);
  expect(Array.from(input.channels.first)).toEqual(Array.from(values.subarray(0, 9)));
  expect(Array.from(input.channels.second)).toEqual(Array.from(values.subarray(9)));
  expect(input.channels.second.get(0)).toBe(9.5);
  expect(values.byteLength).toBe(144);
});
it("shares immutable input bands across readers and releases them after the last reader", async () => {
  const f = fixture(),
    grid = createGrid("surface", scope(), 9, 9);
  channels(grid);
  const shared = await writeFieldLayout(f.resources, grid, "layout", 1e-6);
  await writeFieldChannels(f.resources, grid, "height", shared, ["height"]);
  await writeFieldChannels(f.resources, grid, "water", shared, ["water"]);
  const inputs = new FieldInputCache(f.resources, f.blocks.cache),
    first = new FieldWorkingSet(f.resources, f.blocks.cache, inputs),
    second = new FieldWorkingSet(f.resources, f.blocks.cache, inputs);
  const a = await first.load("height", ["height"], shared.geography),
    b = await second.load("water", ["water"], shared.geography);
  expect(a.active).toBe(b.active);
  expect(a.measures).toBe(b.measures);
  first.close();
  expect(b.active.get(0)).toBe(1);
  expect(b.channels.water.get(12)).toBe(grid.channels.water.get(12));
  expect(() => a.channels.height.get(0)).toThrow(/released/);
  second.close();
  expect(() => b.active.get(0)).toThrow(/released/);
});
it("preserves immutable authored input bands through snapshot copies without sample reads", async () => {
  const f = fixture(),
    grid = createGrid("surface", scope(), 517, 71);
  channels(grid);
  const shared = await writeFieldLayout(f.resources, grid, "layout", 1e-6);
  await writeFieldChannels(f.resources, grid, "height", shared, ["height"]);
  const loaded = await f.working.load("height", ["height"], shared.geography),
    original = landscape().domain;
  original.world.fields.push({
    id: loaded.id,
    areaId: "root",
    layerId: "physical",
    algorithm: "authored",
    state: "authored",
    samples: loaded.active.length,
    channels: ["height"],
    source: { kind: "operation", id: "paint" },
  });
  original.numerical[loaded.id] = loaded;
  f.reads.length = 0;
  const copy = cloneSnapshot(original);
  expect(copy.numerical[loaded.id].channels.height).toBe(loaded.channels.height);
  expect(sameValue(copy.numerical[loaded.id], loaded)).toBe(true);
  expect(f.reads).toEqual([]);
  // The overlay itself is a separate immutable resource, without a recursive overlay list.
  const overlay = { ...loaded, overlays: undefined };
  original.numerical[loaded.id].overlays = [{ grid: overlay, channels: ["height"], mapOnly: true }];
  copy.numerical[loaded.id].overlays = [];
  restoreMappedEdits(copy, original);
  expect(copy.numerical[loaded.id].overlays![0].grid.channels.height).toBe(loaded.channels.height);
  expect(copy.numerical[loaded.id].overlays![0].channels).not.toBe(
    original.numerical[loaded.id].overlays![0].channels
  );
  expect(f.reads).toEqual([]);
});
it("opens immutable inputs without copying samples and reads only the touched blocks' chunks", async () => {
  const f = fixture(),
    grid = createGrid("surface", scope(), 517, 71);
  channels(grid);
  const shared = await writeFieldLayout(f.resources, grid, "layout", 1e-6);
  await writeFieldChannels(f.resources, grid, "height", shared, ["height"]);
  const height = grid.channels.height,
    input = await f.resources.openArray("height", "channel_0", f.blocks.cache),
    source = input.values;
  f.reads.length = 0;
  expect(source.get(0)).toBe(height.get(0));
  expect(source.get(516)).toBe(height.get(516));
  // The first block holds 31 rows of 517 samples: the first chunk row's three chunks.
  const chunks = f.reads.filter((key) => key.includes("/c/"));
  expect(chunks.length).toBe(3);
  expect(chunks.every((key) => key.includes("/c/0/"))).toBe(true);
  expect(source.get(70 * 517 + 516)).toBe(height.get(height.length - 1));
  expect(f.blocks.scratch.stats.writtenBytes).toBe(0);
  expect(() => source.set(0, 99)).toThrow(/Immutable/);
  expect(Array.from(readRange(source, 510, 30))).toEqual(Array.from(readRange(height, 510, 30)));
  const output = readRange(source, 510, 30);
  output[0] = 99;
  expect(source.get(510)).toBe(height.get(510));
  expect(output[0]).toBe(99);
  input.close();
  expect(() => source.get(0)).toThrow(/released/);
  expect(output[0]).toBe(99);
});
describe("regular resource field round trips", () => {
  it("reads categories from only the visible partitions, preserving cell overlap at the edge", async () => {
    const f = fixture(),
      grid = createGrid("classes", scope(), 517, 71);
    putChannel(
      grid,
      "cover",
      "category",
      generateBand(grid.coverage, "float64", "cover", (i) =>
        i % 517 < 256 ? 1 : i % 517 < 512 ? 2 : 3
      ),
      "category"
    );
    const shared = await writeFieldLayout(f.resources, grid, "layout", 1e-6),
      resource = await writeFieldChannels(f.resources, grid, "classes", shared);
    f.reads.length = 0;
    expect(
      await resourceCategories(f.resources, resource, "cover", rectangle([0, 0, 480, 1000]))
    ).toEqual([1]);
    expect(f.reads.some((key) => key.includes("/channel_0/c/0/1"))).toBe(false);
    f.reads.length = 0;
    expect(await resourceCategories(f.resources, resource, "cover", grid.scope.footprint)).toEqual([
      1, 2, 3,
    ]);
    expect(f.reads).toEqual([]);
    expect(
      await resourceCategories(f.resources, resource, "cover", rectangle([990, 0, 1000, 1000]))
    ).toEqual([2, 3]);
  });
  it("round trips regular edge tiles without loading unselected channels or duplicating layout chunks", async () => {
    const f = fixture(),
      grid = createGrid("surface", scope(), 517, 71);
    channels(grid);
    grid.periodicWidth = 1000;
    const shared = await writeFieldLayout(f.resources, grid, "layout", 0.000001);
    const first = await writeFieldChannels(f.resources, grid, "height", shared, ["height"]);
    await writeFieldChannels(f.resources, grid, "water", shared, ["water"]);
    expect(first.partitions.length).toBe(6);
    expect(first.arrays.filter((a) => a.source).map((a) => a.name)).toEqual(["active", "measures"]);
    f.reads.length = 0;
    const loaded = await f.working.load("height", ["height"], shared.geography);
    expect(Array.from(loaded.channels.height)).toEqual(Array.from(grid.channels.height));
    expect(Array.from(loaded.measures)).toEqual(Array.from(grid.measures));
    expect(loaded.ocean).toEqual(grid.ocean);
    expect(loaded.periodicWidth).toBe(1000);
    expect(gridSchema.safeParse(loaded).success).toBe(true);
    expect(f.reads.some((key) => key.includes("/water/"))).toBe(false);
    const window = {
      resourceId: "height",
      arrays: ["channel_0"],
      extent: [1, 1, 2, 2] as [number, number, number, number],
      halo: 0,
    };
    const selected = [];
    for await (const part of f.resources.readWindow(window)) selected.push(part);
    expect(selected.length).toBe(1);
    expect(() => loaded.channels.height.set(0, 123)).toThrow(/Immutable/);
    expect(
      (await f.resources.readPartition("height", first.partitions[0].id, ["channel_0"])).arrays
        .channel_0[0]
    ).toBe(0);
    // Inputs larger than the budget evict and reload from their chunks; nothing spills.
    expect(f.blocks.cache.stats.peakBytes).toBeLessThanOrEqual(blockBudget);
    expect(f.blocks.cache.stats.evictions).toBeGreaterThan(0);
    expect(f.blocks.scratch.stats.writtenBytes).toBe(0);
    f.working.close();
    expect(() => loaded.channels.height.get(0)).toThrow();
  });
});
describe("adaptive resource fields", () => {
  it("uses adaptive cell footprints for category visibility", async () => {
    const f = fixture(),
      grid = createAdaptiveField(
        "classes",
        scope(),
        createAdaptiveTopology([0, 0, 1000, 1000], { maximumSize: 250, minimumSize: 250 })
      );
    putChannel(
      grid,
      "cover",
      "category",
      generateBand(grid.coverage, "float64", "cover", (i) => i + 1),
      "category"
    );
    const shared = await writeFieldLayout(f.resources, grid, "layout", 1e-6),
      resource = await writeFieldChannels(f.resources, grid, "classes", shared);
    expect(
      await resourceCategories(f.resources, resource, "cover", rectangle([10, 10, 100, 100]))
    ).toEqual([grid.channels.cover.get(adaptiveLeafAt(grid.topology!, 50, 50))]);
  });
  it("preserves adaptive tree identities, reciprocal faces, units and shared layouts", async () => {
    const f = fixture();
    const topology = createAdaptiveTopology([0, 0, 1000, 1000], {
      maximumSize: 500,
      minimumSize: 125,
      refine: (box) => box[0] < 500 && box[1] < 500,
    });
    const grid = createAdaptiveField("surface", scope(), topology);
    channels(grid);
    const shared = await writeFieldLayout(f.resources, grid, "adaptive", 0.000001);
    await writeFieldChannels(f.resources, grid, "terrain", shared);
    const loaded = await f.working.load("terrain", ["height", "water"], shared.geography);
    expect(loaded.topology).toBeDefined();
    expect(loaded.topology!.bounds).toEqual(topology.bounds);
    for (const name of bandNames(topology) as (keyof typeof topology)[])
      expect(Array.from(loaded.topology![name] as Band)).toEqual(
        Array.from(topology[name] as Band)
      );
    expect(adaptiveLeafAt(loaded.topology!, 100, 100)).toBe(adaptiveLeafAt(topology, 100, 100));
    expect(loaded.units).toEqual(grid.units);
    expect(loaded.quantities).toEqual(grid.quantities);
    expect(gridSchema.safeParse(loaded).success).toBe(true);
    const again = await f.working.load("terrain", ["height"], shared.geography);
    expect(again.active).toBe(loaded.active);
    expect(again.topology!.boxes).toBe(loaded.topology!.boxes);
    const cells = [];
    for await (const part of f.resources.readWindow({
      resourceId: "terrain",
      arrays: ["channel_0"],
      extent: grid.bounds,
      halo: 0,
    }))
      cells.push(part);
    expect(cells.length).toBe(1);
  });
});
describe("adaptive resource field edge cases", () => {
  it("handles a single adaptive cell with no faces and rejects missing inputs", async () => {
    const f = fixture(),
      topology = createAdaptiveTopology([0, 0, 1000, 1000], {
        maximumSize: 1000,
        minimumSize: 1000,
      });
    const grid = createAdaptiveField("single", scope(), topology);
    channels(grid);
    const shared = await writeFieldLayout(f.resources, grid, "single-layout", 0.000001);
    await writeFieldChannels(f.resources, grid, "single", shared);
    const loaded = await f.working.load("single", ["height"], shared.geography);
    expect(loaded.topology!.neighbors.length).toBe(0);
    expect(Array.from(loaded.topology!.offsets)).toEqual([0, 0]);
    await expect(f.working.load("single", ["missing"], shared.geography)).rejects.toThrow(
      /channels/
    );
    await expect(
      f.working.load("single", ["height"], { ...shared.geography, id: "wrong" })
    ).rejects.toThrow(/geography/);
  });
});
describe("field publication failures", () => {
  it.each(["/channel_0/zarr.json", "/channel_0/c/"])(
    "reclaims an owned failed output at %s while retaining immutable inputs",
    async (failure) => {
      const f = fixture(),
        grid = createGrid("surface", scope(), 9, 9);
      channels(grid);
      const shared = await writeFieldLayout(f.resources, grid, "layout", 1e-6);
      f.fault.write = failure;
      await expect(writeFieldChannels(f.resources, grid, "failure", shared)).rejects.toThrow(
        /storage write/
      );
      expect([...f.values.keys()].some((key) => key.includes("/failure/"))).toBe(false);
      expect((await f.resources.describe("layout")).state).toBe("ready");
      expect((await writeFieldChannels(f.resources, grid, "failure", shared)).state).toBe("ready");
    }
  );
  it("reclaims a completed layout when its adaptive tree fails before publication", async () => {
    const f = fixture(),
      grid = createAdaptiveField(
        "surface",
        scope(),
        createAdaptiveTopology([0, 0, 1000, 1000], { maximumSize: 500, minimumSize: 500 })
      );
    channels(grid);
    f.fault.write = "/children/";
    await expect(writeFieldLayout(f.resources, grid, "adaptive", 1e-6)).rejects.toThrow(
      /storage write/
    );
    expect([...f.values.keys()]).toEqual([]);
  });
});
