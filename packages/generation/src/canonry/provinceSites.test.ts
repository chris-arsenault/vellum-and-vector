import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { createProvinceSites } from "./provinceSites";
import { continentalWorldProfile } from "./worldScale";
import { tectonicProvinces } from "./provinces";
import { tectonicSites } from "./tectonicState";
import { siteMotion } from "./tectonicMotion";

it("moves mechanical plates coherently while keeping continental ancestry independent", () => {
  const profile = atlasPhysicalProfile({ continents: 4 });
  const map = createField(createWorldMesh([0, 0, 4_000_000, 3_000_000], 1024, 0));
  const sites = tectonicSites(map, physicalContext(73, 0, profile)),
    plates = map.tectonics!.plates;
  expect(new Set(sites.filter((site) => site.assembly > 0).map((site) => site.assembly)).size).toBe(
    4
  );
  for (const site of sites) {
    const plate = plates.find((plate) => plate.id === site.plate)!;
    expect([site.motionX, site.motionY]).toEqual(siteMotion(map, site, plate));
  }
  const origins = new Map<number, Set<number>>();
  for (const site of sites)
    if (site.assembly > 0) {
      if (!origins.has(site.assembly)) origins.set(site.assembly, new Set());
      origins.get(site.assembly)!.add(site.plate);
    }
  expect([...origins.values()].some((membership) => membership.size > 1)).toBe(true);
  const mixed = plates.some((plate) => {
    const members = sites.filter((site) => site.plate === plate.id);
    return members.some((site) => site.assembly === 0) && members.some((site) => site.assembly > 0);
  });
  expect(mixed).toBe(true);
});

it("allocates unequal assembly territories while respecting an area-based crust budget", () => {
  const bounds: [number, number, number, number] = [0, 0, 4_000_000, 3_000_000];
  const profile = continentalWorldProfile(atlasPhysicalProfile(), bounds);
  for (const seed of [73, 104729, 42, 157]) {
    const map = createField(createWorldMesh(bounds, 16384, 0));
    const context = physicalContext(seed, 0x6b31e7, profile);
    const sites = createProvinceSites(map, context);
    tectonicProvinces(map, context);
    const areas = new Float64Array(sites.length),
      groups = new Map<number, number>();
    let continental = 0,
      total = 0;
    for (let i = 0; i < map.mesh.count; i++) {
      if (map.mesh.membership(i) !== 1) continue;
      const area = map.mesh.contentArea(i);
      areas[map.CrustProvinceIds.get(i) - 1] += area;
      continental += (area * map.CrustContinentalFraction.get(i)) / 1000;
      total += area;
    }
    for (const [i, site] of sites.entries())
      if (site.assembly > 0) groups.set(site.assembly, (groups.get(site.assembly) ?? 0) + areas[i]);
    expect(groups.size).toBe(profile.ContinentalAssemblyCount);
    expect(Math.max(...areas) / Math.min(...areas)).toBeGreaterThan(3);
    expect(new Set(groups.values()).size).toBe(groups.size);
    const counts = [...groups.keys()].map(
      (id) => sites.filter((site) => site.assembly === id).length
    );
    expect(new Set(counts).size).toBeGreaterThan(1);
    const spacing = sites.map((a, i) =>
      Math.min(...sites.filter((_, j) => j !== i).map((b) => Math.hypot(a.x - b.x, a.y - b.y)))
    );
    expect(Math.max(...spacing) / Math.min(...spacing)).toBeGreaterThan(3);
    // Discrete provinces and blended/rifted margins approximate, rather than exactly solve,
    // the creator's area budget. This checks its physical meaning, not an Earth size distribution.
    expect(Math.abs(continental / total - profile.ContinentalCrustFraction)).toBeLessThan(0.05);
    expect(sites).toEqual(createProvinceSites(map, context));
  }
});
