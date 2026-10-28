import { expect, it } from "vitest";
import { createAdaptiveTopology, rectangle } from "@atlas/domain";
import { adaptivePhysicalMesh } from "../../generation/src/canonry/adaptiveMesh";
import { createField } from "../../generation/src/canonry/field";
import { physicalContext } from "../../generation/src/canonry/context";
import { atlasPhysicalProfile } from "../../generation/src/canonry/atlasProfile";
import { flowRouting } from "../../generation/src/canonry/routing";
import { analyseTerrain } from "../../generation/src/canonry/landmarkSitingRules";
import { reconcileRemeshedWater } from "../../generation/src/canonry/remeshWater";
import { blockCacheFixture } from "./blockCacheFixture";

function meshFixture() {
  const bounds: [number, number, number, number] = [0, 0, 8000, 8000];
  return adaptivePhysicalMesh(
    createAdaptiveTopology(bounds, {
      maximumSize: 1000,
      minimumSize: 1000,
    }),
    rectangle(bounds)
  );
}
it("routes a supplied lake across disk pages to its real outlet and measures land and sea distances", () => {
  const f = blockCacheFixture(2048);
  try {
    const mesh = meshFixture(),
      map = createField(mesh, f.cache);
    const cells = Array.from({ length: mesh.count }, (_, i) => i).sort(
      (a, b) => mesh.x(a) - mesh.x(b) || mesh.y(a) - mesh.y(b)
    );
    const ocean = cells.at(-1)!,
      outlet = cells.at(-2)!;
    map.WaterKindCodes.fill(2);
    map.WaterBodyIds.fill(73);
    map.WaterKindCodes.set(ocean, 1);
    map.LakeOutletTargets.set(outlet, ocean);
    map.Elevation.fill(100 * 1024);
    flowRouting(map, physicalContext(42, 0, atlasPhysicalProfile()));
    expect(map.FlowTargets.get(ocean)).toBe(-1);
    for (const start of cells) {
      let cell = start,
        steps = 0;
      while (cell !== ocean && steps++ < cells.length) {
        const target = map.FlowTargets.get(cell);
        expect(
          Array.from({ length: mesh.degree(cell) }, (_, e) => mesh.neighbor(cell, e))
        ).toContain(target);
        cell = target;
      }
      expect(cell).toBe(ocean);
    }
    for (const [order, i] of cells.slice(0, 20).entries()) {
      map.WaterKindCodes.set(i, 0);
      map.RiverOrders.set(i, 1);
      map.FlowAccumulation.set(i, order + 1);
    }
    const terrain = analyseTerrain(map);
    expect(Array.from(terrain.land)).toHaveLength(20);
    expect(Array.from(terrain.ocean)).toEqual([ocean]);
    expect(Array.from(terrain.rivers)).toEqual(cells.slice(0, 20).reverse());
    const distance = (a: number, b: number) =>
      Math.abs(mesh.x(a) - mesh.x(b)) + Math.abs(mesh.y(a) - mesh.y(b));
    expect(terrain.offshore.get(ocean)).toBeCloseTo(
      Math.min(...cells.slice(0, 20).map((i) => distance(i, ocean))),
      6
    );
    expect(terrain.sea.get(cells[0])).toBeCloseTo(distance(ocean, cells[0]), 6);
    expect(Array.from(map.Elevation).every((v) => v === 100 * 1024)).toBe(true);
    expect(f.cache.stats.loads).toBeGreaterThan(0);
    map.coverage.releaseProcess();
    expect(map.FlowTargets.get(outlet)).toBe(ocean);
  } finally {
    f.close();
  }
});
it("retains the supplied lake inventory when changed support raises its floor", () => {
  const f = blockCacheFixture(2048);
  try {
    const mesh = meshFixture(),
      previous = createField(mesh, f.cache),
      next = createField(mesh, f.cache);
    for (let i = 0; i < 10; i++) {
      previous.WaterKindCodes.set(i, 2);
      next.WaterKindCodes.set(i, 2);
      previous.WaterBodyIds.set(i, 73);
      next.WaterBodyIds.set(i, 73);
      previous.WaterDepths.set(i, 5 * 1024);
      previous.WaterSurfaceElevations.set(i, 5 * 1024);
      next.Elevation.set(i, i * 1024);
    }
    const volumeOf = (map: typeof next) => {
      let sum = 0;
      for (let i = 0; i < mesh.count; i++) sum += map.WaterDepths.get(i) * mesh.area(i);
      return sum;
    };
    const volume = volumeOf(previous);
    reconcileRemeshedWater(previous, next);
    for (let i = 0; i < 10; i++) expect(next.WaterSurfaceElevations.get(i)).toBe(9.5 * 1024);
    expect(volumeOf(next)).toBe(volume);
    expect(next.WaterDepths.get(20)).toBe(0);
    expect(previous.WaterDepths.get(0)).toBe(5 * 1024);
  } finally {
    f.close();
  }
});
