import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField, type PhysicalField } from "./field";
import { units } from "./math";
import { oceanConnectivity, groundedIceWater } from "./ocean";
import { createWorldMesh } from "./worldMesh";
import { blockCacheFixture } from "../../../storage-browser/src/blockCacheFixture";

it.each([false, true])(
  "converges on fractional elevation without rounding a bracket onto itself (file storage: %s)",
  (fileBacked) => {
    const working = fileBacked ? blockCacheFixture() : undefined;
    try {
      const mesh = createWorldMesh([0, 0, 100, 100], 16, 0);
      const map = createField(mesh, working?.cache);
      map.Elevation.fill(-100.5);
      let area = 0;
      for (let i = 0; i < mesh.count; i++)
        if (mesh.membership(i) !== 0) area += mesh.contentArea(i);
      map.BaseOceanVolume = (area * 1023.75) / 1024;
      map.SeaLevelInitialized = true;
      map.CompletedEpochCount = 1;
      const budget = map.BaseOceanVolume;
      // Fail an infinite loop inside synchronous code instead of wedging the test runner.
      // Bisection of this 1024-unit interval needs eleven passes at unit precision.
      let reads = 0;
      map.Elevation = new Proxy(map.Elevation, {
        get(target, key) {
          if (key === "get" || key === "block")
            return (...args: [number, boolean?]) => {
              if (++reads > mesh.count * 256)
                throw new Error("Ocean level failed to converge on the supplied bracket.");
              return (target[key] as (...a: [number, boolean?]) => unknown)(...args);
            };
          return Reflect.get(target, key, target);
        },
      });
      oceanConnectivity(map, physicalContext(1, 0, atlasPhysicalProfile()));
      expect(map.BaseSeaLevel).toBeCloseTo(923.5, 6);
      expect(Math.abs(oceanVolume(map) - budget)).toBeLessThan(area / 1024);
      expect(map.BaseOceanVolume).toBe(budget);
      for (let i = 0; i < mesh.count; i++) expect(map.Elevation.get(i)).toBe(-100.5);
    } finally {
      working?.close();
    }
  }
);

function oceanVolume(map: ReturnType<typeof createField>) {
  let volume = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.membership(i) !== 0 && map.WaterKindCodes.get(i) === 1)
      volume += ((map.EffectiveSeaLevel - map.Elevation.get(i)) / 1024) * map.mesh.contentArea(i);
  return volume;
}
const oceanCells = (map: ReturnType<typeof createField>) => {
  let count = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.membership(i) === 1 && map.WaterKindCodes.get(i) === 1) count++;
  return count;
};

/** Lower every live cell whose elevation satisfies the predicate by the given metres. */
function sinkLiveCells(map: PhysicalField, where: (elevation: number) => boolean, metres: number) {
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.membership(i) !== 0 && where(map.Elevation.get(i)))
      map.Elevation.add(i, -units(metres));
}
function countLiveCells(map: PhysicalField, where: (elevation: number) => boolean) {
  let count = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.membership(i) !== 0 && where(map.Elevation.get(i))) count++;
  return count;
}
it("sets the water budget at the first flood and keeps it when the land later sinks", () => {
  const map = createField(createWorldMesh([0, 0, 400_000, 400_000], 1024, 0));
  // A ramp from a deep western sea to eastern uplands.
  for (let i = 0; i < map.mesh.count; i++)
    map.Elevation.set(i, units(-600 + (map.mesh.x(i) + 200_000) / 200));
  const context = physicalContext(1, 0, atlasPhysicalProfile());
  oceanConnectivity(map, context);
  const firstOcean = oceanCells(map),
    firstBudget = map.BaseOceanVolume;
  expect(firstBudget).toBeGreaterThan(0);
  expect(oceanVolume(map)).toBeCloseTo(firstBudget, -6);
  // The coarse ramp floods whole columns around the configured coverage target.
  expect(firstOcean / map.mesh.contentCount).toBeCloseTo(
    context.Profile.QualityTargets.OceanCoverage.target,
    1
  );

  // A later formation flood re-measures the budget on the planet formation has built: the deep
  // basin sinks, the shoreline cells that set the area target do not.
  sinkLiveCells(map, (elevation) => elevation < map.BaseSeaLevel - units(300), 200);
  oceanConnectivity(map, context);
  expect(oceanCells(map)).toBe(firstOcean);
  expect(map.BaseOceanVolume).toBeGreaterThan(firstBudget);
  const budgetAfterFormation = map.BaseOceanVolume,
    formationLevel = map.BaseSeaLevel;

  // In an epoch every land cell sinks by 150 m, as aged or diluted crust did before the fix.
  context.IsEvolutionEpoch = true;
  sinkLiveCells(map, (elevation) => elevation > formationLevel, 150);
  const fixedLevelFlood = countLiveCells(map, (elevation) => elevation < formationLevel);
  oceanConnectivity(map, context);
  const budget = budgetAfterFormation,
    firstLevel = formationLevel;
  expect(map.BaseSeaLevel).toBeLessThan(firstLevel);
  expect(oceanVolume(map) / budget).toBeGreaterThan(0.99);
  expect(oceanVolume(map) / budget).toBeLessThan(1.01);
  // The sea spreads onto sunken land, but the falling level drowns less than a fixed datum would.
  const drowned = oceanCells(map) - firstOcean;
  expect(drowned).toBeGreaterThanOrEqual(0);
  expect(drowned).toBeLessThan(fixedLevelFlood - firstOcean);

  // An epoch's eustatic offset still applies on top of the conserved base level.
  context.SeaLevelOffset = -40;
  oceanConnectivity(map, context);
  expect(map.EffectiveSeaLevel).toBe(map.BaseSeaLevel - units(40));
});

it("exchanges grounded ice with ocean water, excludes floating ice and never resets the final budget", () => {
  const map = createField(createWorldMesh([0, 0, 400_000, 400_000], 1024, 0));
  for (let i = 0; i < map.mesh.count; i++) map.Elevation.set(i, units(map.mesh.x(i) / 200));
  const context = physicalContext(1, 0, atlasPhysicalProfile());
  oceanConnectivity(map, context);
  const budget = map.BaseOceanVolume,
    warmLevel = map.BaseSeaLevel;
  map.CompletedEpochCount = 1;
  for (let i = 0; i < map.mesh.count; i++) {
    map.IceThickness.set(i, 200);
    map.GroundedIce.set(i, map.mesh.x(i) > 100_000 ? 1 : 0);
  }
  oceanConnectivity(map, context);
  const coldLevel = map.BaseSeaLevel;
  expect(coldLevel).toBeLessThan(warmLevel);
  expect((oceanVolume(map) + groundedIceWater(map)) / budget).toBeCloseTo(1, 5);
  expect(map.BaseOceanVolume).toBe(budget);
  oceanConnectivity(map, context);
  expect(map.BaseSeaLevel).toBe(coldLevel);
  map.GroundedIce.fill(0); // The remaining floating ice does not remove ocean water.
  oceanConnectivity(map, context);
  expect(map.BaseSeaLevel).toBeCloseTo(warmLevel, -1);
  map.IceThickness.fill(0);
  map.GlacialMeltwater.fill(1000); // Routing is a forcing, not another ocean inventory deposit.
  oceanConnectivity(map, context);
  expect(map.BaseSeaLevel).toBeCloseTo(warmLevel, -1);
  map.Elevation.add(0, -units(500));
  oceanConnectivity(map, context);
  expect(map.BaseOceanVolume).toBe(budget);
  context.SeaLevelOffset = 40;
  oceanConnectivity(map, context);
  expect(map.EffectiveSeaLevel).toBe(map.BaseSeaLevel + units(40));
});
