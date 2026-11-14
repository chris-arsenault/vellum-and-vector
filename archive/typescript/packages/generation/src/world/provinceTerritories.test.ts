import { expect, it } from "vitest";
import { provinceAdjacency, provinceAreas, provinceTerritories } from "./provinceTerritories";

it("derives real province neighbors and Voronoi cell areas within the chart", () => {
  const sites = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 5 },
  ];
  const result = provinceTerritories(sites, [-2, -2, 6, 7], 0);
  expect([...result.areas].reduce((sum, area) => sum + area, 0)).toBeCloseTo(72);
  expect(result.areas[0]).toBeGreaterThan(0);
  for (const [a, b] of [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ]) {
    expect(result.adjacent[a * sites.length + b]).toBe(1);
    expect(result.adjacent[b * sites.length + a]).toBe(1);
  }
  expect([...result.adjacent].reduce((sum, edge) => sum + edge, 0)).toBe(10);
});

it("keeps periodic cell areas and contacts across the seam without self-contacts", () => {
  const sites = [
    { x: -4.8, y: 0 },
    { x: 4.8, y: 0 },
    { x: 0, y: -2 },
    { x: 0, y: 3 },
  ];
  const first = provinceTerritories(sites, [-5, -5, 5, 5], 10);
  const moved = sites.map((p) => ({ x: p.x + 10, y: p.y }));
  const shifted = provinceTerritories(moved, [5, -5, 15, 5], 10);
  expect(first.adjacent[1]).toBe(1);
  expect(first.adjacent[sites.length]).toBe(1);
  for (let i = 0; i < sites.length; i++) expect(first.adjacent[i * sites.length + i]).toBe(0);
  expect(shifted.adjacent).toEqual(first.adjacent);
  expect([...first.areas].reduce((sum, area) => sum + area, 0)).toBeCloseTo(100);
  [...shifted.areas].forEach((area, i) => expect(area).toBeCloseTo(first.areas[i]));
  // The two seam sites face each other across the seam, so their cells are equal.
  expect(first.areas[0]).toBeCloseTo(first.areas[1]);
  expect(provinceAdjacency(sites, 10)).toEqual(first.adjacent);
});

it("gives a repeated site no separate area", () => {
  const sites = [
    { x: 1, y: 1 },
    { x: 1, y: 1 },
    { x: 3, y: 1 },
  ];
  expect([...provinceAreas(sites, [0, 0, 4, 2], 0)]).toEqual([4, 0, 4]);
});
