import { expect, it } from "vitest";
import { residentBand } from "@atlas/domain";
import { metricSearch } from "./metricSearch";
import { createWorldMesh } from "./worldMesh";

/** Shortest distances by repeated relaxation, the slow reference for the heap search. */
function reference(mesh: ReturnType<typeof createWorldMesh>, seeds: number[], reach: number) {
  const distance = new Float64Array(mesh.count).fill(Infinity);
  for (const s of seeds) distance[s] = 0;
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < mesh.count; i++)
      for (let edge = 0; edge < mesh.degree(i); edge++) {
        const j = mesh.neighbor(i, edge),
          next = distance[i] + mesh.edgeLength(i, edge);
        if (j >= 0 && next <= reach && next < distance[j]) {
          distance[j] = next;
          changed = true;
        }
      }
  }
  return distance;
}

it("finds geodesic distances from several seeds within the reach, visiting each cell from its parent", () => {
  const mesh = createWorldMesh([0, 0, 6000, 6000], 36, 0),
    seeds = [0, Math.floor(mesh.count / 2)],
    reach = 2600,
    values = new Float64Array(mesh.count).fill(Infinity);
  for (const s of seeds) values[s] = 0;
  const distance = residentBand("float64", values),
    parent = new Int32Array(mesh.count).fill(-1);
  metricSearch(mesh, seeds, distance, reach, (target, source) => (parent[target] = source));
  const expected = reference(mesh, seeds, reach);
  let reached = 0;
  for (let i = 0; i < mesh.count; i++) {
    expect(distance.get(i)).toBeCloseTo(expected[i], 9);
    if (!Number.isFinite(expected[i]) || seeds.includes(i)) continue;
    reached++;
    // The recorded parent is a neighbour one edge closer to a seed.
    const p = parent[i];
    expect(p).toBeGreaterThanOrEqual(0);
    let edgeLength = Infinity;
    for (let edge = 0; edge < mesh.degree(p); edge++)
      if (mesh.neighbor(p, edge) === i) edgeLength = mesh.edgeLength(p, edge);
    expect(distance.get(i)).toBeCloseTo(distance.get(p) + edgeLength, 9);
    expect(distance.get(i)).toBeLessThanOrEqual(reach);
  }
  expect(reached).toBeGreaterThan(0);
  // The reach cut something off.
  expect(Array.from(expected).some((d) => !Number.isFinite(d))).toBe(true);
});
