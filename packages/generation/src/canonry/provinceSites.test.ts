import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { createProvinceSites } from "./provinceSites";
import { provinceAdjacency, provinceAreas } from "./provinceTerritories";
import { initialTectonicSites } from "./tectonicInitialization";
import { createWorldMesh } from "./worldMesh";

const bounds: [number, number, number, number] = [0, 0, 4_000_000, 3_000_000];
const field = () => createField(createWorldMesh(bounds, 4096, 0));
const contextFor = (parameters: object) => physicalContext(11, 0, atlasPhysicalProfile(parameters));

function connected(sites: { x: number; y: number }[], members: number[]) {
  const adjacent = provinceAdjacency(sites, 0),
    reached = new Set([members[0]]),
    queue = [members[0]];
  for (const i of queue)
    for (const j of members)
      if (!reached.has(j) && adjacent[i * sites.length + j]) {
        reached.add(j);
        queue.push(j);
      }
  return reached.size === members.length;
}

it("keeps one block of provinces as ocean, holding half the world's water", () => {
  const map = field(),
    sites = createProvinceSites(map, contextFor({})),
    areas = provinceAreas(sites, map.mesh.bounds, 0),
    members = sites.flatMap((site, i) => (site.oceanPlate === 1 ? [i] : [])),
    world = areas.reduce((sum, area) => sum + area, 0),
    held = members.reduce((sum, i) => sum + areas[i], 0);
  expect(connected(sites, members)).toBe(true);
  expect(members.every((i) => sites[i].assembly === 0)).toBe(true);
  expect(held / world).toBeGreaterThan(0.3);
  expect(held / world).toBeLessThan(0.45);
});

it("keeps the world's land share when an ocean plate takes its provinces", () => {
  const share = (oceanicPlates: number) => {
    const map = field(),
      sites = createProvinceSites(map, contextFor({ oceanicPlates })),
      areas = provinceAreas(sites, map.mesh.bounds, 0);
    return (
      sites.reduce((sum, site, i) => sum + (site.assembly > 0 ? areas[i] : 0), 0) /
      areas.reduce((sum, area) => sum + area, 0)
    );
  };
  expect(Math.abs(share(1) - share(0))).toBeLessThan(0.05);
});

it("adds no ocean plate when set to none, and shrinks it on a land-heavy world", () => {
  const held = (parameters: object) => {
    const map = field(),
      sites = createProvinceSites(map, contextFor(parameters)),
      areas = provinceAreas(sites, map.mesh.bounds, 0);
    return (
      sites.reduce((sum, site, i) => sum + (site.oceanPlate ? areas[i] : 0), 0) /
      areas.reduce((sum, area) => sum + area, 0)
    );
  };
  expect(held({ oceanicPlates: 0 })).toBe(0);
  expect(held({ landFraction: 0.7 })).toBeLessThan(held({ landFraction: 0.35 }));
});

it("moves an ocean plate as one, on a plate of its own", () => {
  const sites = initialTectonicSites(field(), contextFor({})),
    ocean = sites.filter((site) => site.oceanPlate > 0);
  expect(new Set(ocean.map((site) => site.plate)).size).toBe(1);
  expect(sites.some((site) => !site.oceanPlate && site.plate === ocean[0].plate)).toBe(false);
  expect(new Set(ocean.map((site) => site.driveX)).size).toBe(1);
});

it("starts each continent whole on one plate", () => {
  const sites = initialTectonicSites(field(), contextFor({})),
    continents = new Set(sites.map((site) => site.assembly).filter((id) => id > 0));
  expect(continents.size).toBeGreaterThan(1);
  for (const id of continents)
    expect(new Set(sites.filter((s) => s.assembly === id).map((s) => s.plate)).size).toBe(1);
});

it("gives the largest two assemblies more of the land than the others", () => {
  const map = field(),
    sites = createProvinceSites(map, contextFor({})),
    areas = provinceAreas(sites, map.mesh.bounds, 0),
    land = new Map<number, number>();
  sites.forEach((site, i) => {
    if (site.assembly) land.set(site.assembly, (land.get(site.assembly) ?? 0) + areas[i]);
  });
  const sizes = [...land.values()].sort((a, b) => b - a),
    total = sizes.reduce((sum, size) => sum + size, 0);
  expect((sizes[0] + sizes[1]) / total).toBeGreaterThan(0.6);
});
