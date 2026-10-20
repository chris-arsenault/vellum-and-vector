import { expect, it } from "vitest";
import { createAdaptiveTopology, adaptiveCell } from "@atlas/domain";
import { fitLandscapeHeights } from "./macroFit";

it("connects regional height targets without moving protected surroundings", () => {
  const topology = createAdaptiveTopology([0, 0, 1000, 1000], {
      maximumSize: 125,
      minimumSize: 125,
    }),
    count = topology.leaves.length,
    target = new Float64Array(count),
    confidence = new Float64Array(count),
    fixed = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const [x, y, right, top] = adaptiveCell(topology, i);
    fixed[i] = Number(x === 0 || y === 0 || right === 1000 || top === 1000);
    if (x === 375 && y === 375) {
      target[i] = -100;
      confidence[i] = 100;
      fixed[i] = 1;
    }
  }
  const result = fitLandscapeHeights(topology, target, confidence, fixed, 250, 0.001);
  expect(result.iterations).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    if (fixed[i]) expect(result.values[i]).toBe(target[i]);
    else {
      expect(result.values[i]).toBeLessThan(0);
      expect(result.values[i]).toBeGreaterThan(-100);
    }
  }
});

it("retains a prescribed steep section rather than smoothing its drop away", () => {
  const topology = createAdaptiveTopology([0, 0, 1000, 1000], {
      maximumSize: 125,
      minimumSize: 125,
    }),
    target = Float64Array.from(topology.leaves, (_, i) =>
      adaptiveCell(topology, i)[0] < 500 ? 100 : -100
    ),
    confidence = new Float64Array(target.length).fill(1),
    fixed = new Uint8Array(target.length);
  expect(fitLandscapeHeights(topology, target, confidence, fixed, 250).values).toEqual(target);
});
