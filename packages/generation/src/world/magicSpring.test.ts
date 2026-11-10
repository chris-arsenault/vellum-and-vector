import { expect, it } from "vitest";
import { springResponse, springSubstrate } from "./magicGreenwoodSources";
import { siteStrength } from "./magicStocks";
import { rockCatalogue } from "../rock/rockCatalogue";

it("responds to dissolved concentration and discharge without a source-label cutoff", () => {
  const weak = springResponse(1, 100, 1, 1, 1);
  expect(weak).toBeGreaterThan(0);
  expect(siteStrength(weak)).toBe(0);
  expect(springResponse(100, 100, 1, 1, 1)).toBe(250);
  expect(springResponse(100, 100, 2, 1, 1)).toBeGreaterThan(250);
  expect(springResponse(100, 200, 1, 1, 1)).toBeLessThan(250);
});

it("needs actual charged water and remains bounded at high concentration", () => {
  expect(springResponse(0, 100, 1, 1, 1)).toBe(0);
  expect(springResponse(100, 0, 1, 1, 1)).toBe(0);
  expect(springResponse(100, 100, 0, 1, 1)).toBe(0);
  expect(springResponse(1, Number.MIN_VALUE, 1, 1, 1)).toBe(500);
});

it("retains response under coherent scaling of charge, water and dimensional controls", () => {
  const response = springResponse(100, 100, 1, 1, 1);
  expect(springResponse(400, 800, 8, 0.5, 8)).toBe(response);
});

it("uses replacement hydraulic material instead of retaining a volcanic veto", () => {
  const entry = (rock: { porosity: number; solubility: number }) =>
    Math.max(rock.porosity, rock.solubility);
  expect(springSubstrate(1, entry(rockCatalogue.limestone))).toBeGreaterThan(
    springSubstrate(1, entry(rockCatalogue.basalt))
  );
  expect(springSubstrate(1, entry(rockCatalogue.saltbed))).toBeGreaterThan(0.35);
  expect(springSubstrate(0, entry(rockCatalogue.limestone))).toBe(0);
});
