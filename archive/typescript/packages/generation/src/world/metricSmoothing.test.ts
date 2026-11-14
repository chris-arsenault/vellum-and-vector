import { expect, it } from "vitest";
import { createTestField as createField } from "../rock/groundTestFixture";
import { smoothMetric } from "./metricSmoothing";
import { createWorldMesh } from "./worldMesh";

it("leaves a constant alone, conserves the area-weighted total and spreads a spike outward", () => {
  const mesh = createWorldMesh([0, 0, 6000, 6000], 36, 0),
    map = createField(mesh),
    n = mesh.count,
    weighted = (band: { get(i: number): number }) => {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += band.get(i) * mesh.area(i);
      return sum;
    };
  map.Elevation.fill(7);
  const flat = smoothMetric(map, map.Elevation, 1500);
  for (let i = 0; i < n; i++) expect(flat.get(i)).toBeCloseTo(7, 9);
  // A spike at the centre.
  const centre = Array.from({ length: n }, (_, i) => i).reduce((a, b) =>
    Math.hypot(mesh.x(b), mesh.y(b)) < Math.hypot(mesh.x(a), mesh.y(a)) ? b : a
  );
  map.Elevation.fill(0);
  map.Elevation.set(centre, 1000);
  const spread = smoothMetric(map, map.Elevation, 1500);
  expect(weighted(spread)).toBeCloseTo(weighted(map.Elevation), 6);
  expect(spread.get(centre)).toBeLessThan(1000);
  expect(spread.get(centre)).toBeGreaterThan(0);
  // Every cell gained something, and each ring of neighbours (by hops from the centre) holds
  // less on average than the ring inside it.
  const hops = new Int32Array(n).fill(-1),
    queue = [centre];
  hops[centre] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (let edge = 0; edge < mesh.degree(i); edge++) {
      const j = mesh.neighbor(i, edge);
      if (j >= 0 && hops[j] < 0) {
        hops[j] = hops[i] + 1;
        queue.push(j);
      }
    }
  }
  let farther = spread.get(centre);
  for (const ring of [1, 2, 3]) {
    const at = Array.from({ length: n }, (_, i) => i).filter((i) => hops[i] === ring);
    expect(at.length).toBeGreaterThan(0);
    for (const i of at) expect(spread.get(i)).toBeGreaterThan(0);
    const mean = at.reduce((s, i) => s + spread.get(i), 0) / at.length;
    expect(mean).toBeLessThan(farther);
    farther = mean;
  }
});
