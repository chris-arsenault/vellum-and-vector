import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { continentalWorldProfile, areaBudget, mediumArea } from "./worldScale";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { physicalContext } from "./context";
import { createProvinceSites } from "./provinceSites";
import { tectonicProvinces } from "./provinces";
import { worldCandidates } from "./worldSources";
import { plannedImpacts } from "./impacts";

it("scales broad shape with province dimensions while preserving physical feature widths and counts", () => {
  const base = atlasPhysicalProfile();
  const bigger = continentalWorldProfile(base, [0, 0, 40_000_000, 30_000_000]);
  expect(bigger.ContinentalWarpStrength).toBe(base.ContinentalWarpStrength * 10);
  expect(bigger.ContinentalWarpScale).toBe(base.ContinentalWarpScale * 10);
  expect(bigger.ContinentalTransitionWidth).toBe(base.ContinentalTransitionWidth * 10);
  for (const name of [
    "ContinentalAssemblyCount",
    "TectonicProvinceCount",
    "ImpactMinimumRadius",
    "CollisionRangeWidth",
    "PlateDriftPerEpoch",
    "WindTerrainLength",
  ] as const)
    expect(bigger[name]).toBe(base[name]);
});

it("preserves broad crust transitions at matching relative positions on differently sized maps", () => {
  const fields = [1, 10].map((scale) => {
    const bounds: [number, number, number, number] = [0, 0, 4_000_000 * scale, 2_000_000 * scale];
    const map = createField(createWorldMesh(bounds, 4096, 0));
    const profile = continentalWorldProfile(atlasPhysicalProfile(), bounds);
    tectonicProvinces(map, physicalContext(73, 0, profile));
    return map;
  });
  const share = (map: (typeof fields)[number]) =>
    map.CrustContinentalFraction.slice(0, map.mesh.contentCount).filter(
      (value) => value > 0 && value < 1000
    ).length / map.mesh.contentCount;
  expect(Math.abs(share(fields[0]) - share(fields[1]))).toBeLessThan(0.03);
});

it("distributes candidates to all rectangle edges and continental anchors along an elongated domain", () => {
  const map = createField(createWorldMesh([0, 0, 40_000_000, 2_000_000], 1024, 0));
  const candidates = worldCandidates(map.mesh, 42, 10000);
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? 40_000_000 : 2_000_000;
    expect(candidates.some((c) => c[axis] < -size * 0.49)).toBe(true);
    expect(candidates.some((c) => c[axis] > size * 0.49)).toBe(true);
  }
  const sites = createProvinceSites(
    map,
    physicalContext(73, 0, atlasPhysicalProfile({ continents: 4 }))
  );
  expect(
    sites.filter((site) => site.assembly > 0).some((site) => Math.abs(site.x) > 10_000_000)
  ).toBe(true);
});

it("scales event budgets with physical area, preserves zero and keeps radii independent of area", () => {
  expect(areaBudget(6, 12e12)).toBe(6);
  expect(areaBudget(6, 120e12)).toBe(60);
  expect(areaBudget(0, 120e12)).toBe(0);
  expect(areaBudget(6, 0)).toBe(0);
  const impacts = [1, 4].map((scale) => {
    const map = createField(createWorldMesh([0, 0, 4_000_000 * scale, 3_000_000], 1024, 0));
    const profile = atlasPhysicalProfile();
    profile.ImpactPrimordialShare = 1000;
    expect(mediumArea(map)).toBeCloseTo(12e12 * scale, -2);
    return plannedImpacts(map, physicalContext(73, 0, profile));
  });
  expect(impacts[1].length).toBe(impacts[0].length * 4);
  for (const event of impacts.flat()) expect(event.radius).toBeGreaterThanOrEqual(50_000);
  for (const event of impacts.flat()) expect(event.radius).toBeLessThanOrEqual(180_000);
});
