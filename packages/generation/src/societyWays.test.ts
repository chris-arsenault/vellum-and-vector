import { expect, it } from "vitest";
import { wayClass, wayClasses, wornCost } from "./societyWays";
import { compactGroups } from "./societyGroups";

it("classes a way by its yearly travellers", () => {
  expect(wayClass({ wear: 0 })).toBeNull();
  expect(wayClass({ wear: wayClasses().track })).toBe("track");
  expect(wayClass({ wear: wayClasses().road })).toBe("road");
  expect(wornCost({ distance: 1000, wear: 0, kind: "land" })).toBe(1000);
  expect(wornCost({ distance: 1000, wear: wayClasses().road * 3, kind: "land" })).toBeCloseTo(600);
  expect(wornCost({ distance: 1000, wear: wayClasses().road * 3, kind: "sea" })).toBe(1000);
});

it("folds slivers into the largest group of the same people without changing the count", () => {
  const groups = compactGroups([
    { people: "p", culture: "a", languages: [], religions: [], practices: [], count: 100 },
    { people: "p", culture: "b", languages: [], religions: [], practices: [], count: 0.4 },
    { people: "p", culture: "c", languages: [], religions: [], practices: [], count: 2 },
  ]);
  expect(groups).toHaveLength(2);
  expect(groups.reduce((s, g) => s + g.count, 0)).toBeCloseTo(102.4, 9);
  expect(groups.find((g) => g.culture === "a")!.count).toBeCloseTo(100.4, 9);
});
