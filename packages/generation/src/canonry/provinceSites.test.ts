import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { createProvinceSites } from "./provinceSites";
import { continentalWorldProfile } from "./worldScale";
import { tectonicProvinces } from "./provinces";

it("moves the provinces of one continental assembly together while assemblies differ", () => {
  const profile = atlasPhysicalProfile({ continents: 4 });
  const map = createField(createWorldMesh([0, 0, 4_000_000, 3_000_000], 1024, 0));
  const sites = createProvinceSites(map, physicalContext(73, 0, profile));
  const byAssembly = new Map<number, typeof sites>();
  for (const site of sites)
    if (site.assembly > 0)
      byAssembly.set(site.assembly, [...(byAssembly.get(site.assembly) ?? []), site]);
  expect(byAssembly.size).toBe(4);
  // Each province keeps (1 − coherence) of its own motion, so two provinces of one assembly
  // can differ by at most that share of two opposed maximum motions.
  const bound = (1 - profile.AssemblyMotionCoherence) * 2 * profile.TectonicMotionMaximum + 1e-9;
  const means: [number, number][] = [];
  for (const group of byAssembly.values()) {
    for (const a of group)
      for (const b of group)
        expect(Math.hypot(a.motionX - b.motionX, a.motionY - b.motionY)).toBeLessThanOrEqual(bound);
    means.push([
      group.reduce((s, site) => s + site.motionX, 0) / group.length,
      group.reduce((s, site) => s + site.motionY, 0) / group.length,
    ]);
  }
  const spread = Math.max(
    ...means.flatMap((a) => means.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])))
  );
  expect(spread).toBeGreaterThan(bound);
  // Oceanic provinces still drift on their own.
  const oceanic = sites.filter((site) => site.assembly === 0);
  expect(oceanic.length).toBeGreaterThan(1);
  const oceanicSpread = Math.max(
    ...oceanic.flatMap((a) =>
      oceanic.map((b) => Math.hypot(a.motionX - b.motionX, a.motionY - b.motionY))
    )
  );
  expect(oceanicSpread).toBeGreaterThan(bound);
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
    for (let i = 0; i < map.mesh.contentCount; i++) {
      const area = map.mesh.contentAreas[i];
      areas[map.CrustProvinceIds[i] - 1] += area;
      continental += (area * map.CrustContinentalFraction[i]) / 1000;
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
