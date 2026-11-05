import { expect, it } from "vitest";
import { fallHeight, trueFallSize } from "./waterfallSize";

const share = (test: (height: number) => boolean) => {
  let count = 0;
  for (let i = 0; i < 100_000; i++) if (test(fallHeight(i / 100_000))) count++;
  return count / 100_000;
};

it("makes most falls ordinary", () => {
  expect(share((height) => height < 30)).toBeGreaterThan(0.8);
});

it("gives Niagara's height to more falls than Earth has, and a few beyond Victoria's", () => {
  expect(share((height) => height >= 50)).toBeGreaterThan(0.05);
  expect(share((height) => height >= 162)).toBeGreaterThan(0);
  expect(share((height) => height >= 162)).toBeLessThan(0.005);
  expect(fallHeight(0.99999)).toBeLessThanOrEqual(216);
});

it("never falls further than its stretch of river loses", () => {
  const { height } = trueFallSize({ budget: 12, discharge: 100, fracture: 0 }, 0.999, 0.5);
  expect(height).toBe(12);
});

it("spends a large budget on one drop in hard rock and on a system in broken rock", () => {
  const hard = trueFallSize({ budget: 500, discharge: 100, fracture: 0 }, 0.5, 0.5),
    broken = trueFallSize({ budget: 500, discharge: 100, fracture: 0.6 }, 0.5, 0.5);
  expect(hard.members).toBe(1);
  expect(hard.length).toBe(0);
  expect(broken.members).toBeGreaterThan(1);
  expect(broken.length).toBeGreaterThan(0);
});

it("widens with water, up to a limit", () => {
  const small = trueFallSize({ budget: 50, discharge: 10, fracture: 0 }, 0.5, 0.5),
    great = trueFallSize({ budget: 50, discharge: 2400, fracture: 0 }, 0.5, 0.5),
    vast = trueFallSize({ budget: 50, discharge: 1e6, fracture: 0 }, 0.5, 1);
  expect(great.width).toBeGreaterThan(small.width);
  expect(vast.width).toBe(3400);
});
