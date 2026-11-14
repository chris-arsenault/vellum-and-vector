import { expect, it } from "vitest";
import { gradePair, gradeRound } from "./grading";

it("grades a supplied step by cutting its high side and filling its low side", () => {
  const heights = [100, 0];
  expect(gradePair(heights, [true, true], 0, 1, 20, [1, 3], 1)).toBe(true);
  expect(heights).toEqual([40, 20]);
  expect(gradePair(heights, [true, true], 0, 1, 20, [1, 3], 1)).toBe(false);
});

it("keeps a protected neighboring height fixed", () => {
  const heights = [100, 0];
  expect(gradePair(heights, [true, false], 0, 1, 20, [1, 1], 1)).toBe(true);
  expect(heights).toEqual([20, 0]);
});

it("stops below the stored native unit or when floating point cannot change either height", () => {
  expect(gradePair([20.5, 0], [true, true], 0, 1, 20, [1, 1], 1)).toBe(false);
  const heights = [1e30, 1e30 - 2 ** 47];
  expect(gradePair(heights, [true, true], 0, 1, 2 ** 47 - 2, [1, 1], 1)).toBe(false);
});

it("stops once every step is within the slack it is given, however small the next move", () => {
  const heights = [30, 0];
  expect(gradePair(heights, [true, true], 0, 1, 20, [1, 1], 15)).toBe(false);
  expect(heights).toEqual([30, 0]);
  // A long bench between two fixed ends relaxes in a bounded number of rounds.
  const bench = Array.from({ length: 40 }, (_, i) => (i < 20 ? 0 : 4000)),
    edges = bench.slice(1).map((_, i) => [i, i + 1, 100] as const);
  let rounds = 0;
  while (
    gradeRound(
      bench,
      bench.map((_, i) => i > 0 && i < 39),
      bench.map(() => 1),
      edges,
      5
    )
  )
    rounds++;
  expect(rounds).toBeLessThan(2000);
});

it("settles incompatible grades between protected neighbors without alternating forever", () => {
  const heights = [0.25, 50.25, 100.25];
  expect(
    gradeRound(
      heights,
      [false, true, false],
      [1, 1, 1],
      [
        [0, 1, 10],
        [1, 2, 10],
      ]
    )
  ).toBe(false);
  expect(heights).toEqual([0.25, 50.25, 100.25]);
});
