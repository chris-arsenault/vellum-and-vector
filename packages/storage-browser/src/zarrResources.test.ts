import { describe, expect, it } from "vitest";
import type { NumericalResource, ResourceWindow } from "@atlas/domain";
import type { BinaryStore } from "./opfsStore";
import { ZarrResources } from "./zarrResources";

class TestStore implements BinaryStore {
  values = new Map<string, Uint8Array>();
  reads: string[] = [];
  async get(key: string) {
    this.reads.push(key);
    return this.values.get(key)?.slice();
  }
  async set(key: string, data: Uint8Array) {
    this.values.set(key, data.slice());
  }
  async deletePrefix(prefix: string) {
    for (const key of this.values.keys()) if (key.startsWith(`${prefix}/`)) this.values.delete(key);
  }
  async snapshot(keys: string[]) {
    const values = new Map(keys.map((key) => [key, this.values.get(key)]));
    return {
      read: (key: string) => {
        this.reads.push(key);
        return values.get(key)?.slice();
      },
      close() {
        values.clear();
      },
    };
  }
}
function fixture() {
  const store = new TestStore(),
    resources = new ZarrResources(store, 128);
  const resource: NumericalResource = {
    id: "terrain",
    schemaVersion: 1,
    revision: 1,
    state: "working",
    layout: "regular",
    scope: { worldId: "world", spaceId: "world", areaId: "root" },
    crsId: "world:metres",
    precision: 0.000001,
    bounds: [0, 0, 400, 100],
    sampling: { width: 4, height: 2 },
    arrays: ["height", "heat"].map((name) => ({
      name,
      dtype: "float64",
      shape: [2, 4],
      chunkShape: [2, 2],
      unit: "metre",
      quantity: "intensive",
    })),
    partitions: [0, 1].map((i) => ({
      id: String(i),
      bounds: [i * 200, 0, (i + 1) * 200, 100],
      cellStart: i * 4,
      cellCount: 4,
      neighbors: [String(1 - i)],
      arraySlices: Object.fromEntries(
        ["height", "heat"].map((name) => [name, { offset: [0, i * 2], shape: [2, 2] }])
      ),
    })),
  };
  const window: ResourceWindow = {
    resourceId: resource.id,
    arrays: ["height"],
    extent: [10, 10, 100, 90],
    halo: 0,
  };
  return { store, resources, resource, window };
}
async function fill(f: ReturnType<typeof fixture>) {
  await f.resources.create(f.resource);
  for (const reference of f.resource.partitions)
    await f.resources.writePartition(f.resource.id, {
      reference,
      arrays: {
        height: Float64Array.from([1, 2, 3, 4]),
        heat: Float64Array.from([10, 20, 30, 40]),
      },
    });
}
describe("Zarr numerical resources", () => {
  it("reads selected spatial chunks and channels, retaining caller-owned samples", async () => {
    const f = fixture();
    await fill(f);
    await f.resources.finish(f.resource.id);
    f.store.reads = [];
    const chunks = [];
    for await (const chunk of f.resources.readWindow(f.window)) chunks.push(chunk);
    expect(chunks).toHaveLength(1);
    expect([...chunks[0].arrays.height]).toEqual([1, 2, 3, 4]);
    expect(f.store.reads.some((key) => key.includes("/heat/"))).toBe(false);
    expect(f.store.reads.filter((key) => key.includes("/c/"))).toEqual([
      "/resources/terrain/height/c/0/0",
    ]);
    chunks[0].arrays.height[0] = 999;
    expect((await f.resources.readPartition("terrain", "0", ["height"])).arrays.height[0]).toBe(1);
  });
  it("rejects incomplete publication and mutation of completed arrays", async () => {
    const f = fixture();
    await f.resources.create(f.resource);
    await expect(f.resources.readPartition("terrain", "0", ["height"])).rejects.toThrow(
      /not been written/
    );
    const partition = {
      reference: f.resource.partitions[0],
      arrays: { height: Float64Array.of(1, 2, 3, 4) },
    };
    await f.resources.writePartition("terrain", partition);
    await expect(f.resources.finish("terrain")).rejects.toThrow(/every declared/);
    await expect(
      f.resources.writePartition("terrain", {
        ...partition,
        arrays: { height: new Float64Array(3) },
      })
    ).rejects.toThrow(/type and shape/);
    await f.resources.writePartition("terrain", {
      reference: f.resource.partitions[0],
      arrays: { heat: new Float64Array(4) },
    });
    await f.resources.writePartition("terrain", {
      reference: f.resource.partitions[1],
      arrays: { height: new Float64Array(4), heat: new Float64Array(4) },
    });
    expect((await f.resources.finish("terrain")).state).toBe("ready");
    await expect(f.resources.writePartition("terrain", partition)).rejects.toThrow(
      /cannot be changed/
    );
    await f.resources.remove("terrain");
    await expect(f.resources.describe("terrain")).rejects.toThrow(/unavailable/);
  });
  it("reopens the same persisted format and rejects unknown arrays", async () => {
    const f = fixture();
    await fill(f);
    const reopened = new ZarrResources(f.store);
    expect([...(await reopened.readPartition("terrain", "1", ["heat"])).arrays.heat]).toEqual([
      10, 20, 30, 40,
    ]);
    await expect(reopened.readPartition("terrain", "1", ["missing"])).rejects.toThrow(/No missing/);
  });
});
describe("shared numerical layouts", () => {
  it("reads immutable shared arrays without duplicating their Zarr chunks", async () => {
    const f = fixture();
    await fill(f);
    await f.resources.finish("terrain");
    const alias: NumericalResource = {
      ...f.resource,
      id: "display",
      arrays: f.resource.arrays.map((a) => ({
        ...a,
        source: { resourceId: "terrain", array: a.name },
      })),
    };
    await f.resources.create(alias);
    await expect(
      f.resources.writePartition(alias.id, {
        reference: alias.partitions[0],
        arrays: { height: Float64Array.of(9, 9, 9, 9) },
      })
    ).rejects.toThrow(/Shared/);
    await f.resources.finish(alias.id);
    expect(
      [...f.store.values.keys()].some((key) => key.startsWith("/resources/display/height/"))
    ).toBe(false);
    const partition = await f.resources.readPartition(alias.id, "0", ["height"]);
    expect([...partition.arrays.height]).toEqual([1, 2, 3, 4]);
    partition.reference.bounds[0] = 999;
    expect((await f.resources.describe(alias.id)).partitions[0].bounds[0]).toBe(0);
    const descriptor = await f.resources.describe("terrain");
    descriptor.arrays[0].unit = "wrong";
    expect((await f.resources.describe("terrain")).arrays[0].unit).toBe("metre");
    await expect(
      f.resources.create({
        ...alias,
        id: "wrong-units",
        arrays: [{ ...alias.arrays[0], unit: "ratio" }],
      })
    ).rejects.toThrow(/units/);
  });
});
describe("empty numerical arrays", () => {
  it("preserves empty adjacency arrays for a valid single-cell topology", async () => {
    const f = fixture();
    const resource: NumericalResource = {
      ...f.resource,
      id: "one-cell",
      layout: "adaptive",
      arrays: [
        {
          name: "neighbors",
          dtype: "int32",
          shape: [0],
          chunkShape: [4],
          unit: "index",
          quantity: "topology",
        },
      ],
      partitions: [
        {
          id: "0",
          bounds: [0, 0, 100, 100],
          cellStart: 0,
          cellCount: 1,
          neighbors: [],
          arraySlices: { neighbors: { offset: [0], shape: [0] } },
        },
      ],
    };
    await f.resources.create(resource);
    await f.resources.writePartition(resource.id, {
      reference: resource.partitions[0],
      arrays: { neighbors: new Int32Array(0) },
    });
    await f.resources.finish(resource.id);
    const result = await f.resources.readPartition(resource.id, "0", ["neighbors"]);
    expect(result.arrays.neighbors).toBeInstanceOf(Int32Array);
    expect(result.arrays.neighbors.length).toBe(0);
  });
});
