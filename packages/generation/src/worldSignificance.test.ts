import { expect, it } from "vitest";
import {
  fallsSignificance,
  independenceSignificance,
  lakeSignificance,
  landscapeSignificance,
  largeWorldDomain,
  rangeSignificance,
  riverSignificance,
  summitSignificance,
} from "./worldSignificance";

const world = { area: 12e12, span: 5_000_000 };
const forest = { area: 180e9, breadth: 100_000, coherence: 0.8, contrast: 0.4, strength: 0.8 };

it("recognizes broad landscapes while rejecting ribbons and scattered local patches", () => {
  expect(landscapeSignificance(world, "forest", forest).publish).toBe(true);
  expect(landscapeSignificance(world, "forest", { ...forest, breadth: 2_000 }).publish).toBe(false);
  expect(landscapeSignificance(world, "forest", { ...forest, coherence: 0.2 }).publish).toBe(false);
  expect(
    landscapeSignificance(world, "forest", { ...forest, strength: 0.3, contrast: 0 }).publish
  ).toBe(false);
  const wetland = { ...forest, area: 6e9, breadth: 35_000 };
  expect(landscapeSignificance(world, "wetland", wetland).publish).toBe(true);
  expect(landscapeSignificance(world, "forest", wetland).publish).toBe(false);
});

it("reserves subdivision for continental domains, independently of named-region eligibility", () => {
  expect(largeWorldDomain(forest.area, 500_000, 4e12)).toBe(false);
  expect(largeWorldDomain(1.5e12, 1_600_000, 4e12)).toBe(true);
  expect(largeWorldDomain(1.5e12, 500_000, 4e12)).toBe(false);
});

it("requires river contribution rather than membership in someone else's major basin", () => {
  const trunk = { discharge: 2_000, catchment: 150e9, length: 900_000, outlet: true };
  expect(riverSignificance(trunk).publish).toBe(true);
  expect(riverSignificance({ ...trunk, discharge: 15, catchment: 3e9 }).publish).toBe(false);
  expect(riverSignificance({ ...trunk, length: 60_000 }).publish).toBe(true);
  expect(riverSignificance({ ...trunk, length: 60_000, outlet: false }).publish).toBe(false);
});

it("recognizes exceptional small sites without promoting ordinary peaks or dry drops", () => {
  expect(summitSignificance(1_600, 120_000).publish).toBe(true);
  expect(summitSignificance(1_600, 2_000).publish).toBe(false);
  expect(summitSignificance(100, 120_000).publish).toBe(false);
  expect(fallsSignificance(60, 2_000).publish).toBe(true);
  expect(fallsSignificance(60, 2).publish).toBe(false);
  expect(fallsSignificance(2, 2_000).publish).toBe(false);
  expect(rangeSignificance(forest, 1_200, 600_000).publish).toBe(true);
  expect(rangeSignificance(forest, 30, 600_000).publish).toBe(false);
  expect(lakeSignificance(500e6, 300, 0).publish).toBe(true);
  expect(lakeSignificance(500e6, 5, 0).publish).toBe(false);
});

it("allows a supported small independent state but not an unsupported isolated community", () => {
  const seat = {
    residents: 2_500,
    capacity: 3_000,
    years: 150,
    connectedResidents: 2_500,
    institution: true,
  };
  expect(independenceSignificance(seat).publish).toBe(true);
  expect(independenceSignificance({ ...seat, institution: false }).publish).toBe(false);
  expect(independenceSignificance({ ...seat, capacity: 500 }).publish).toBe(false);
  expect(
    independenceSignificance({ ...seat, institution: false, connectedResidents: 8_000 }).publish
  ).toBe(true);
});
