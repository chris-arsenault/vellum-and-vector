import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";
import { createProvinceSites } from "./provinceSites";

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
