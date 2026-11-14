import { expect, it } from "vitest";
import { createWorldMesh } from "../world/worldMesh";
import { drainageTree } from "./evolution";

it("routes flat terrain to supplied roots without inventing an eroded surface", () => {
  const mesh = createWorldMesh([0, 0, 1000, 1000], 32, 0),
    n = mesh.count,
    heights = new Float64Array(n).fill(30),
    resistance = new Float64Array(n).fill(1),
    roots = new Uint8Array(n),
    levels = new Float64Array(n).fill(30),
    sea = new Uint8Array(n);
  roots[0] = 1;
  const tree = drainageTree(mesh, heights, resistance, roots, levels, sea),
    rank = new Int32Array(n);
  for (let k = 0; k < tree.count; k++) rank[tree.order[k]] = k;
  expect(tree.count).toBe(n);
  expect(tree.receiver[0]).toBe(-1);
  for (let i = 1; i < n; i++) {
    expect(tree.receiver[i]).toBeGreaterThanOrEqual(0);
    expect(rank[tree.receiver[i]]).toBeLessThan(rank[i]);
  }
  expect(Array.from(heights).every((height) => height === 30)).toBe(true);
});
