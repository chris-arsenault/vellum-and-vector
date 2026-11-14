import { expect, it } from "vitest";
import { sourceSiteCells } from "./magicInheritance";

it("captures discrete candidates independently from their later strength and disappearance", () => {
  const current = new Float64Array([0, 900, 0, 12, 0]),
    band = { length: current.length, get: (cell: number) => current[cell] },
    candidates = sourceSiteCells(band);
  current[1] = 0;
  current[3] = 700;
  current[4] = 1000;
  expect(Array.from(candidates)).toEqual([1, 3]);
  expect(Array.from(sourceSiteCells(band))).toEqual([3, 4]);
});

it("an empty captured candidate set stays distinct from inventing fresh world candidates", () => {
  const candidates = sourceSiteCells({ length: 4, get: () => 0 });
  expect(candidates).toBeInstanceOf(Int32Array);
  expect(candidates.length).toBe(0);
});
