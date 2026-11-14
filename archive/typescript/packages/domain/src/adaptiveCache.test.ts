import { expect, it } from "vitest";
import { adaptiveCell, createAdaptiveTopology } from "./adaptiveTopology";
import { adaptivePointSampler } from "./adaptivePoint";
import { generateBand } from "./lattice/bandValues";

it("retains the same reconstructed plane after visiting enough cells to evict derived geometry and fits", () => {
  const topology = createAdaptiveTopology([0, 0, 64, 64], { maximumSize: 1, minimumSize: 1 });
  const plane = (x: number, y: number) => 100 + x * 3 - y * 0.25;
  const values = generateBand(topology.coverage, "float64", "plane", (i) => {
    const [x0, y0, x1, y1] = adaptiveCell(topology, i);
    return plane((x0 + x1) / 2, (y0 + y1) / 2);
  });
  const sample = adaptivePointSampler(topology, values);
  const check = (i: number) => {
    const [x, y, right, top] = adaptiveCell(topology, i),
      px = x + (right - x) * 0.37,
      py = y + (top - y) * 0.61;
    expect(sample(px, py)).toBeCloseTo(plane(px, py), 8);
  };
  for (let i = 0; i < topology.leaves.length; i++) check(i);
  for (const i of [0, 1, 17, topology.leaves.length - 1, 0]) check(i);
});
