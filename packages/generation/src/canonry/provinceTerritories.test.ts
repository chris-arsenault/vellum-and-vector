import { expect, it } from "vitest";
import { provinceTerritories } from "./provinceTerritories";

it("derives real province neighbors even when area samples miss a narrow contact", () => {
  const sites = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 5 },
  ];
  // Samples at province centers cover the area bookkeeping but cannot discover every edge.
  const result = provinceTerritories(sites, sites, 0);
  expect([...result.areas]).toEqual([1, 1, 1, 1]);
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

it("includes province contacts across the seam without adding self-contacts", () => {
  const sites = [
    { x: -4.8, y: 0 },
    { x: 4.8, y: 0 },
    { x: 0, y: -2 },
    { x: 0, y: 3 },
  ];
  const first = provinceTerritories(sites, sites, 10);
  const shifted = provinceTerritories(
    sites.map((p) => ({ x: p.x + 10, y: p.y })),
    sites.map((p) => ({ x: p.x + 10, y: p.y })),
    10
  );
  expect(first.adjacent[1]).toBe(1);
  expect(first.adjacent[sites.length]).toBe(1);
  for (let i = 0; i < sites.length; i++) expect(first.adjacent[i * sites.length + i]).toBe(0);
  expect(shifted.adjacent).toEqual(first.adjacent);
  expect(shifted.areas).toEqual(first.areas);
});
