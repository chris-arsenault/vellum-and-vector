import { closeSync, fsyncSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { NumericalVector } from "@atlas/domain";
import { PagedArena } from "./pagedArena";
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
    for (let edge = 0; edge < mesh.degree[cell]; edge++) {
      const other = mesh.neighbors[cell * mesh.stride + edge];
      if (!members.has(other) || seen.has(other)) continue;
      seen.add(other);
      queue.push(other);
    }
  return seen.size === cells.length;
}
it("extracts complete connected catchment pieces on disk and releases membership after publication", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-regions-")),
    fd = openSync(join(directory, "work.bin"), "w+");
  const arena = new PagedArena(
    {
      read: (bytes, offset) => readSync(fd, bytes, 0, bytes.byteLength, offset),
      write: (bytes, offset) => writeSync(fd, bytes, 0, bytes.byteLength, offset),
      flush: () => fsyncSync(fd),
      close: () => closeSync(fd),
    },
    2048,
    64
  );
  try {
    const state = landscape();
    state.numerical = arena;
    const mesh = createWorldMesh(
      state.surface.bounds,
      512,
      0,
      undefined,
      undefined,
      undefined,
      false,
      false,
      arena
    );
    const map = createField(mesh, arena);
    state.physical = {
      map,
      profile: atlasPhysicalProfile(),
      samples: mesh.x,
      fixed: [],
      inherited: false,
      sampling: { maximumSize: mesh.spacing, minimumSize: mesh.spacing, featureSamples: 2 },
    };
    map.FlowTargets.fill(-1);
    const all = new Set<number>();
    let pieces = 0,
      last: NumericalVector | undefined;
    components(
      state,
      () => true,
      (members) => {
        const cells = [...members];
        expect(connected(mesh, cells)).toBe(true);
        expect(
          members.reduce((area, cell) => area + mesh.contentAreas[cell], 0)
        ).toBeLessThanOrEqual(1e6);
        for (const cell of cells) {
          expect(all.has(cell)).toBe(false);
          all.add(cell);
        }
        pieces++;
        last = members;
      },
      false,
      1e6
    );
    expect(pieces).toBeGreaterThan(1);
    expect(all.size).toBe(mesh.contentCount);
    expect(arena.stats.reads).toBeGreaterThan(0);
    expect(arena.stats.peakDecodedBytes).toBeLessThanOrEqual(2048);
    expect(() => last![0]).toThrow(/released/);
  } finally {
    arena.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
