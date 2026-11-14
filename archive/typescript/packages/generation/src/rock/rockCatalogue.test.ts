import { expect, it } from "vitest";
import {
  baselineRock,
  hardestRock,
  hardnessOf,
  rockCatalogue,
  rockKindIds,
  rockKindOfCode,
  softestRock,
} from "./rockCatalogue";

it("gives every kind one code that finds it again", () => {
  for (const id of rockKindIds) expect(rockKindOfCode(rockCatalogue[id].code).id).toBe(id);
});

it("preserves the original stored rock codes", () => {
  const stored = [
    "strata",
    "shale",
    "sandstone",
    "limestone",
    "saltbed",
    "slate",
    "schist",
    "marble",
    "quartzite",
    "gneiss",
    "granite",
    "basalt",
    "tuff",
    "impactite",
    "veinrock",
    "sinter",
    "corefall",
    "rimerot",
    "auroraCrystal",
    "crushstone",
    "rootstone",
    "tufa",
    "saltGlass",
    "keptStone",
    "tornstone",
  ];
  expect(Object.values(rockCatalogue).map(({ id, code }) => [id, code])).toEqual(
    expect.arrayContaining(stored.map((id, code) => [id, code]))
  );
});

it("treats a code no kind has as ordinary strata", () => {
  expect(rockKindOfCode(99).id).toBe("strata");
  expect(rockCatalogue.strata.code).toBe(0);
});

it("keeps every kind within the field's resistance and its properties in range", () => {
  for (const id of rockKindIds) {
    const { resistance, jointing, bedding, solubility, porosity } = rockCatalogue[id];
    expect(resistance).toBeGreaterThanOrEqual(softestRock);
    expect(resistance).toBeLessThanOrEqual(hardestRock);
    for (const property of [jointing, bedding, solubility, porosity]) {
      expect(property).toBeGreaterThanOrEqual(0);
      expect(property).toBeLessThanOrEqual(1);
    }
  }
});

it("reads hardness from soft to hard without going out of range", () => {
  expect(hardnessOf(0)).toBe(0);
  expect(hardnessOf(hardestRock)).toBe(1);
  expect(hardnessOf(baselineRock)).toBeGreaterThan(0);
  expect(hardnessOf(baselineRock)).toBeLessThan(1);
});
