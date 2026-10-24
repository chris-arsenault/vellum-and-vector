import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { createField } from "./field";
import { units } from "./math";
import { oceanConnectivity } from "./ocean";
import { createWorldMesh } from "./worldMesh";

function oceanVolume(map: ReturnType<typeof createField>) {
  let volume = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.WaterKindCodes[i] === 1)
      volume += ((map.EffectiveSeaLevel - map.Elevation[i]) / 1024) * map.mesh.contentAreas[i];
  return volume;
}
const oceanCells = (map: ReturnType<typeof createField>) =>
  map.WaterKindCodes.slice(0, map.mesh.contentCount).filter((kind) => kind === 1).length;

it("sets the water budget at the first flood and keeps it when the land later sinks", () => {
  const map = createField(createWorldMesh([0, 0, 400_000, 400_000], 1024, 0));
  // A ramp from a deep western sea to eastern uplands.
  for (let i = 0; i < map.mesh.count; i++)
    map.Elevation[i] = units(-600 + (map.mesh.x[i] + 200_000) / 200);
  const context = physicalContext(1, 0, atlasPhysicalProfile());
  oceanConnectivity(map, context);
  const firstOcean = oceanCells(map),
    firstBudget = map.BaseOceanVolume;
  expect(firstBudget).toBeGreaterThan(0);
  expect(oceanVolume(map)).toBeCloseTo(firstBudget, -6);
  expect(firstOcean / map.mesh.contentCount).toBeGreaterThan(0.45);
  expect(firstOcean / map.mesh.contentCount).toBeLessThan(0.6);

  // A later formation flood re-measures the budget on the planet formation has built: the deep
  // basin sinks, the shoreline cells that set the area target do not.
  for (let i = 0; i < map.mesh.count; i++)
    if (map.Elevation[i] < map.BaseSeaLevel - units(300)) map.Elevation[i] -= units(200);
  oceanConnectivity(map, context);
  expect(oceanCells(map)).toBe(firstOcean);
  expect(map.BaseOceanVolume).toBeGreaterThan(firstBudget);
  const budgetAfterFormation = map.BaseOceanVolume,
    formationLevel = map.BaseSeaLevel;

  // In an epoch every land cell sinks by 150 m, as aged or diluted crust did before the fix.
  context.IsEvolutionEpoch = true;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.Elevation[i] > formationLevel) map.Elevation[i] -= units(150);
  const fixedLevelFlood = map.Elevation.filter((value) => value < formationLevel).length;
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
