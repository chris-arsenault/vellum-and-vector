import { expect, it } from "vitest";
import { createAdaptiveTopology, rectangle } from "@atlas/domain";
import { adaptivePhysicalMesh } from "../../generation/src/canonry/adaptiveMesh";
import { createField } from "../../generation/src/canonry/field";
import { physicalContext } from "../../generation/src/canonry/context";
import { atlasPhysicalProfile } from "../../generation/src/canonry/atlasProfile";
import { flowRouting } from "../../generation/src/canonry/routing";
import { analyseTerrain } from "../../generation/src/canonry/landmarkSitingRules";
import { reconcileRemeshedWater } from "../../generation/src/canonry/remeshWater";
import { arenaFixture } from "./numericalFixture";

function meshFixture(arena: ReturnType<typeof arenaFixture>["arena"]) {
  const bounds: [number, number, number, number] = [0, 0, 8000, 8000];
  return adaptivePhysicalMesh(
    createAdaptiveTopology(bounds, {
      maximumSize: 1000,
      minimumSize: 1000,
    }),
    rectangle(bounds),
    arena
  );
}
it("routes a supplied lake across disk pages to its real outlet and measures land and sea distances", () => {
  const f = arenaFixture(2048, 64);
  try {
    const mesh = meshFixture(f.arena),
      map = createField(mesh, f.arena);
    const cells = [...mesh.x.keys()].sort((a, b) => mesh.x[a] - mesh.x[b] || mesh.y[a] - mesh.y[b]);
    const ocean = cells.at(-1)!,
      outlet = cells.at(-2)!;
    map.WaterKindCodes.fill(2);
    map.WaterBodyIds.fill(73);
    map.WaterKindCodes[ocean] = 1;
    map.LakeOutletTargets[outlet] = ocean;
    map.Elevation.fill(100 * 1024);
    flowRouting(map, physicalContext(42, 0, atlasPhysicalProfile()));
    expect(map.FlowTargets[ocean]).toBe(-1);
    for (const start of cells) {
      let cell = start,
        steps = 0;
      while (cell !== ocean && steps++ < cells.length) {
        const target = map.FlowTargets[cell];
        expect([
          ...mesh.neighbors.subarray(cell * mesh.stride, cell * mesh.stride + mesh.degree[cell]),
        ]).toContain(target);
        cell = target;
      }
      expect(cell).toBe(ocean);
    }
    for (const [order, i] of cells.slice(0, 20).entries()) {
      map.WaterKindCodes[i] = 0;
      map.RiverOrders[i] = 1;
      map.FlowAccumulation[i] = order + 1;
    }
    const terrain = analyseTerrain(map);
    expect(Array.from(terrain.land)).toHaveLength(20);
    expect(Array.from(terrain.ocean)).toEqual([ocean]);
    expect(Array.from(terrain.rivers)).toEqual(cells.slice(0, 20).reverse());
    const distance = (a: number, b: number) =>
      Math.abs(mesh.x[a] - mesh.x[b]) + Math.abs(mesh.y[a] - mesh.y[b]);
    expect(terrain.offshore[ocean]).toBeCloseTo(
      Math.min(...cells.slice(0, 20).map((i) => distance(i, ocean))),
      6
    );
    expect(terrain.sea[cells[0]]).toBeCloseTo(distance(ocean, cells[0]), 6);
    expect(map.Elevation.every((v) => v === 100 * 1024)).toBe(true);
    expect(f.arena.stats.reads).toBeGreaterThan(0);
    f.arena.releaseProcess();
    expect(map.FlowTargets[outlet]).toBe(ocean);
  } finally {
    f.close();
  }
});
it("retains the supplied lake inventory when changed support raises its floor", () => {
  const f = arenaFixture(2048, 64);
  try {
    const mesh = meshFixture(f.arena),
      previous = createField(mesh, f.arena),
      next = createField(mesh, f.arena);
    for (let i = 0; i < 10; i++) {
      previous.WaterKindCodes[i] = next.WaterKindCodes[i] = 2;
      previous.WaterBodyIds[i] = next.WaterBodyIds[i] = 73;
      previous.WaterDepths[i] = 5 * 1024;
      previous.WaterSurfaceElevations[i] = 5 * 1024;
      next.Elevation[i] = i * 1024;
    }
    const volume = previous.WaterDepths.reduce((sum, depth, i) => sum + depth * mesh.areas[i], 0);
    reconcileRemeshedWater(previous, next);
    for (let i = 0; i < 10; i++) expect(next.WaterSurfaceElevations[i]).toBe(9.5 * 1024);
    expect(next.WaterDepths.reduce((sum, depth, i) => sum + depth * mesh.areas[i], 0)).toBe(volume);
    expect(next.WaterDepths[20]).toBe(0);
    expect(previous.WaterDepths[0]).toBe(5 * 1024);
  } finally {
    f.close();
  }
});
