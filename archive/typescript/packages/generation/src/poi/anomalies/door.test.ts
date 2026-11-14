import { expect, it } from "vitest";
import { traversableDoor } from "./door";

it("retained named endpoints require a current eligible pair for traversal", () => {
  const named = [3, 7];
  expect(traversableDoor([], named, () => true)).toBe(false);
  expect(traversableDoor([{ a: 3, b: 9 }], named, () => true)).toBe(false);
  expect(traversableDoor([{ a: 7, b: 3 }], named, () => true)).toBe(true);
  expect(traversableDoor([{ a: 3, b: 7 }], named, (cell) => cell !== 7)).toBe(false);
  expect(traversableDoor([{ a: 3, b: 3 }], [3], () => true)).toBe(false);
});
