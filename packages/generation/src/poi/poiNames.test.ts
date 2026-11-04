import { expect, it } from "vitest";
import { stemOf } from "./poiNames";

it("takes a name's term off its end", () => {
  expect(stemOf("Skattad Crag", "Crag")).toBe("Skattad");
  expect(stemOf("Aust Fiter Scar", "Scar")).toBe("Aust Fiter");
});

it("finds no stem when the term is not what the name ends in", () => {
  expect(stemOf("Skattad Peak", "Crag")).toBeNull();
  expect(stemOf("Crag", "Crag")).toBeNull();
  expect(stemOf("Skattad Crag", undefined)).toBeNull();
});
