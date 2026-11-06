import { expect, it } from "vitest";
import { compileMix, givenUp, modeIds } from "./modes";
import { rockCatalogue, rockCodeCount, rockKindIds } from "./rockCatalogue";

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
