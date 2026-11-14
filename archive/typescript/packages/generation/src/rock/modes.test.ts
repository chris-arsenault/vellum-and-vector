import { expect, it } from "vitest";
import {
  burialResponse,
  compileMix,
  givenUp,
  heatedMaterial,
  materialGives,
  modeIds,
} from "./modes";
import { rockCatalogue, rockCodeCount, rockKindIds } from "./rockCatalogue";
import { materialLayer } from "./rockColumn";

it("gives every code one kind", () => {
  const codes = rockKindIds.map((id) => rockCatalogue[id].code);
  expect(new Set(codes).size).toBe(codes.length);
  expect(Math.max(...codes) + 1).toBe(rockCodeCount);
});
it("has every kind answer every mode with a finite amount, and ordinary rock about 1", () => {
  for (const mode of modeIds) {
    const mix = compileMix({ [mode]: 1 });
    for (const id of rockKindIds) {
      const given = givenUp(mix, rockCatalogue[id].code, rockCatalogue[id].resistance);
      expect(Number.isFinite(given)).toBe(true);
      expect(given).toBeGreaterThanOrEqual(0);
      expect(given).toBeLessThan(10);
    }
    if (mode !== "solution")
      expect(givenUp(mix, rockCatalogue.strata.code, 1000)).toBeCloseTo(1, 0);
  }
});
it("lets strength resist grinding but not dissolving", () => {
  const grinding = compileMix({ abrasion: 1 }),
    dissolving = compileMix({ solution: 1 }),
    limestone = rockCatalogue.limestone.code;
  expect(givenUp(grinding, limestone, 2000)).toBeLessThan(givenUp(grinding, limestone, 1000));
  expect(givenUp(dissolving, limestone, 2000)).toBe(givenUp(dissolving, limestone, 1000));
});
it("weights a process's mix of modes by each mode's share", () => {
  const { basalt } = rockCatalogue,
    plucking = givenUp(compileMix({ plucking: 1 }), basalt.code, basalt.resistance),
    abrasion = givenUp(compileMix({ abrasion: 1 }), basalt.code, basalt.resistance),
    both = givenUp(compileMix({ plucking: 0.5, abrasion: 0.5 }), basalt.code, basalt.resistance);
  expect(both).toBeCloseTo((plucking + abrasion) / 2);
});
it("lets a material state what it gives up, whatever its strength", () => {
  const mix = compileMix({ abrasion: 1 }),
    { keptStone } = rockCatalogue;
  expect(givenUp(mix, keptStone.code, 500)).toBe(givenUp(mix, keptStone.code, 3000));
});
it("consolidates deposited material and heats both constituents while retaining formation ages", () => {
  const { alluvium, limestone, sandstone, quartzite, marble } = rockCatalogue,
    loose = materialLayer(alluvium.code, 20, {
      secondaryKind: limestone.code,
      secondaryShare: 0.4,
      strength: 200,
      damage: 0.8,
      formedMin: 2,
      formedMax: 3,
    }),
    buried = burialResponse(loose, 7),
    heated = heatedMaterial(buried, 9),
    abrasion = compileMix({ abrasion: 1 });
  expect(buried.kind).toBe(sandstone.code);
  expect(buried.secondaryKind).toBe(limestone.code);
  expect(materialGives(abrasion, buried)).toBeLessThan(materialGives(abrasion, loose, true));
  expect(heated.kind).toBe(quartzite.code);
  expect(heated.secondaryKind).toBe(marble.code);
  expect(heated.formedMin).toBe(2);
  expect(heated.formedMax).toBe(3);
  expect(heated.altered).toBe(9);
  expect(loose.altered).not.toBe(9);
});
