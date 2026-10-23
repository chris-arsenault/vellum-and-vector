import { expect, it } from "vitest";
import { canonryMagicPresets } from "./magicPresets";
import {
  magicPlacePresentation,
  magicSurfaceBase,
  magicSurfaceCode,
  naturalSurfaceNames,
  surfaceCategories,
} from "./geographySurfaces";

it("numbers magic surface classes after the natural ones in system and rule order", () => {
  const systems = canonryMagicPresets();
  expect(magicSurfaceCode(systems, "fire", "core")).toBe(magicSurfaceBase);
  expect(magicSurfaceCode(systems, "aurora", "field")).toBe(
    magicSurfaceBase + systems[0].features.length
  );
  expect(magicSurfaceCode(systems, "pressure", "nothing")).toBeNull();
  const categories = surfaceCategories(systems);
  const codes = categories.map((category) => category.code);
  expect(new Set(codes).size).toBe(codes.length);
  expect(codes.slice(0, naturalSurfaceNames.length)).toEqual(
    naturalSurfaceNames.map((_, code) => code)
  );
  const spring = categories.find((category) => category.rule === "spring")!;
  expect(spring.code).toBe(magicSurfaceCode(systems, "fire", "spring"));
  expect(spring.name).toBe("Fire · Hot spring");
  expect(spring.color).toBe(magicPlacePresentation("spring").color);
  expect(categories.find((category) => category.name === "Ocean")?.bathymetric).toBe(true);
  expect(categories.find((category) => category.name === "Reef")?.bathymetric).toBe(false);
  // Broad field classes tint the relief; discrete places take the whole colour.
  expect(categories.find((category) => category.rule === "crush")?.tint).toBeLessThan(1);
  expect(categories.find((category) => category.rule === "vent")?.tint).toBe(1);
  expect(categories.find((category) => category.name === "Tundra")?.tint).toBe(1);
});
it("keeps every magic class distinguishable, including rules it has never seen", () => {
  const colors = surfaceCategories(canonryMagicPresets())
    .filter((category) => category.rule)
    .map((category) => category.color);
  expect(new Set(colors).size).toBe(colors.length);
  expect(magicPlacePresentation("custom-rule").symbol).toBe("circle");
  expect(magicPlacePresentation("custom-rule")).toEqual(magicPlacePresentation("custom-rule"));
});
