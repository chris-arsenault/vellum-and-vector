import { describe, expect, it } from "vitest";
import {
  partitionsInWindow,
  resourceChunkKey,
  type NumericalResource,
  type ResourceArray,
} from "./workspaceResources";

const array: ResourceArray = {
  name: "elevation",
  dtype: "float64",
  shape: [80, 60],
  chunkShape: [16, 16],
  unit: "metre",
  quantity: "intensive",
};
const resource: NumericalResource = {
  schemaVersion: 1,
  id: "terrain",
  revision: 1,
  scope: { worldId: "world", spaceId: "world", areaId: "root" },
  crsId: "world:metres",
  bounds: [0, 0, 300, 100],
  precision: 0.000001,
  layout: "adaptive",
  state: "working",
  arrays: [array],
  partitions: [0, 1, 2].map((i) => ({
    id: String(i),
    bounds: [i * 100, 0, (i + 1) * 100, 100],
    cellStart: i * 64,
    cellCount: 64,
    neighbors: [String((i + 1) % 3)],
  })),
};
describe("numerical resource addressing", () => {
  it("addresses edge chunks and rejects out-of-range or ambiguous array paths", () => {
    expect(resourceChunkKey(array, [4, 3])).toBe("elevation/c/4/3");
    expect(() => resourceChunkKey(array, [5, 3])).toThrow(/coordinates/);
    expect(() => resourceChunkKey(array, [-1, 0])).toThrow(/coordinates/);
    expect(() => resourceChunkKey({ ...array, name: "../elevation" }, [0, 0])).toThrow(/name/);
    expect(() => resourceChunkKey({ ...array, chunkShape: [16] }, [0, 0])).toThrow(/dimensions/);
  });
  it("reads spatial partitions and metric halos without treating the region as a new grid", () => {
    const window = {
      resourceId: resource.id,
      arrays: [array.name],
      extent: [110, 10, 180, 80] as [number, number, number, number],
      halo: 0,
    };
    expect(partitionsInWindow(resource, window).map((p) => p.id)).toEqual(["1"]);
    expect(partitionsInWindow(resource, { ...window, halo: 25 }).map((p) => p.id)).toEqual([
      "0",
      "1",
      "2",
    ]);
    expect(resource.partitions[1].cellStart).toBe(64);
    expect(() => partitionsInWindow(resource, { ...window, arrays: ["missing"] })).toThrow(
      /arrays/
    );
    expect(() => partitionsInWindow(resource, { ...window, halo: -1 })).toThrow(/Halo/);
  });
  it("includes opposite seam partitions for metric halos and translated cylinder charts", () => {
    const cylinder = { ...resource, periodicWidth: 300 };
    const window = {
      resourceId: resource.id,
      arrays: [array.name],
      extent: [5, 10, 20, 80] as [number, number, number, number],
      halo: 10,
    };
    expect(partitionsInWindow(cylinder, window).map((p) => p.id)).toEqual(["0", "2"]);
    expect(
      partitionsInWindow(cylinder, { ...window, extent: [305, 10, 320, 80] }).map((p) => p.id)
    ).toEqual(["0", "2"]);
    expect(partitionsInWindow(cylinder, { ...window, halo: 500 }).map((p) => p.id)).toEqual([
      "0",
      "1",
      "2",
    ]);
  });
});
