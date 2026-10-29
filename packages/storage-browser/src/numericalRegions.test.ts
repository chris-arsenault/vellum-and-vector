import { expect, it } from "vitest";
import { generateBand } from "@atlas/domain";
import { blockCacheFixture } from "./blockCacheFixture";
import { landscape } from "../../generation/src/mapFixtures";
import { createWorldMesh } from "../../generation/src/canonry/worldMesh";
import { createField } from "../../generation/src/canonry/field";
import { atlasPhysicalProfile } from "../../generation/src/canonry/atlasProfile";
import { components } from "../../generation/src/canonry/geographicRegions";
import type { PhysicalMesh } from "../../generation/src/canonry/mesh";

function connected(mesh: PhysicalMesh, cells: number[]) {
  const members = new Set(cells),
    seen = new Set([cells[0]]),
    queue = [cells[0]];
  for (const cell of queue)
    for (let edge = 0; edge < mesh.degree(cell); edge++) {
      const other = mesh.neighbor(cell, edge);
      if (!members.has(other) || seen.has(other)) continue;
      seen.add(other);
      queue.push(other);
    }
  return seen.size === cells.length;
}
it("extracts complete connected catchment pieces on disk and releases membership after publication", () => {
  const f = blockCacheFixture(2048);
  try {
    const state = landscape();
    state.domain.world.areas.area.profile = "region";
    state.cache = f.cache;
    const mesh = createWorldMesh(state.surface.bounds, 512, 0);
    const map = createField(mesh, f.cache);
    state.physical = {
      map,
      profile: atlasPhysicalProfile(),
      samples: generateBand(
        state.surface.coverage,
        "int32",
        "physical:samples",
        (i) => i,
        mesh.count
      ),
      grid: state.surface.coverage,
      fixed: [],
      inherited: false,
      sampling: { maximumSize: mesh.spacing, minimumSize: mesh.spacing, featureSamples: 2 },
    };
    map.FlowTargets.fill(-1);
    const all = new Set<number>();
    let pieces = 0;
    components(
      state,
      () => true,
      (members) => {
        const cells = [...members];
        expect(connected(mesh, cells)).toBe(true);
        expect(cells.reduce((area, cell) => area + mesh.contentArea(cell), 0)).toBeLessThanOrEqual(
          1e6
        );
        for (const cell of cells) {
          expect(all.has(cell)).toBe(false);
          all.add(cell);
        }
        pieces++;
      },
      false,
      1e6
    );
    expect(pieces).toBeGreaterThan(1);
    expect(all.size).toBe(mesh.contentCount);
    expect(f.cache.stats.loads).toBeGreaterThan(0);
    expect(f.cache.stats.evictions).toBeGreaterThan(0);
    // The budget is soft by the blocks a pass pins: one whole band here exceeds it.
    expect(f.cache.stats.peakBytes).toBeLessThanOrEqual(8192);
  } finally {
    f.close();
  }
});
