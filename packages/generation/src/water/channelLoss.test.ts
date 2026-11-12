import { expect, it } from "vitest";
import { bedLeak, bedLoss, channelWidth } from "./channelLoss";

it("takes nothing through a bed over full or tight ground, and most through open empty sand", () => {
  const sand = 3e-6;
  expect(bedLeak(sand, 0.6, 1)).toBe(0);
  expect(bedLeak(sand, 0, 0)).toBe(0);
  expect(bedLeak(sand, 0.6, 0)).toBeCloseTo(1.8e-6, 12);
  expect(bedLeak(sand, 0.6, 0.5)).toBeLessThan(bedLeak(sand, 0.6, 0));
});

it("never takes more than the river carries, and takes a larger share of a small river", () => {
  const leak = 1.8e-6,
    length = 14_000;
  expect(bedLoss(0, leak, length)).toBe(0);
  expect(bedLoss(0.01, leak, length)).toBe(0.01);
  const small = bedLoss(5, leak, length) / 5,
    great = bedLoss(2000, leak, length) / 2000;
  expect(small).toBeGreaterThan(great);
  expect(channelWidth(100)).toBeCloseTo(47, 9);
});

it("thins a river crossing dry porous country until it ends, and leaves a great one flowing", () => {
  const leak = 1.8e-6,
    length = 14_000,
    cross = (flow: number, cells: number) => {
      for (let cell = 0; cell < cells && flow > 0; cell++) flow -= bedLoss(flow, leak, length);
      return flow;
    };
  // A stream is gone within a few hundred kilometres of desert, and a small river has lost
  // most of its water by then.
  expect(cross(2, 40)).toBe(0);
  expect(cross(20, 40)).toBeLessThan(10);
  // A great river crosses the same country and arrives smaller.
  const arrived = cross(3000, 40);
  expect(arrived).toBeGreaterThan(1500);
  expect(arrived).toBeLessThan(3000);
  // Over full ground neither loses anything.
  expect(bedLoss(20, bedLeak(3e-6, 0.6, 1), length)).toBe(0);
});
