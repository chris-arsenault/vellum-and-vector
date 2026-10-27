import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { dispersePlants } from "./ecologyEstablishment";
import { evolveAnimals } from "./ecologyAnimals";
import { evolveVegetation } from "./ecologyVegetation";
import { floodEcology } from "./ecologyDisturbance";
import { neutralEcology } from "./ecologyEnvironment";
import { updateTreeCover } from "./ecologyGrowth";
import { units } from "./math";

// A mainland at the centre, islands 150 km upwind and downwind of it in a
// steady 7 m/s westerly, and a remote island about 1,000 km downwind.
const islands = {
  mainland: [-100_000, 100_000],
  upwind: [-300_000, -250_000],
  downwind: [250_000, 300_000],
  remote: [1_100_000, 1_150_000],
} as const;
function archipelago(
  land: (keyof typeof islands)[] = ["mainland", "upwind", "downwind", "remote"]
) {
  const map = createField(createWorldMesh([-600_000, -150_000, 1_300_000, 150_000], 6000, 20_000));
  map.EcologyInitialized = true;
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x[i] + map.mesh.origin[0],
      isle = land.find((name) => x >= islands[name][0] && x <= islands[name][1]);
    map.WaterKindCodes[i] = isle ? 0 : 1;
    map.WaterDepths[i] = isle ? 0 : units(500);
    map.Elevation[i] = units(isle ? 100 : -500);
    map.DrainageElevations[i] = map.Elevation[i];
    map.WindX[i] = 1000;
    map.WindSpeed[i] = 7;
    map.Temperature[i] = 450;
    map.Moisture[i] = 850;
    map.Rainfall[i] = 950;
    map.SoilDepth[i] = 0.5;
    map.SoilWater[i] = 0.1;
    map.MineralNutrients[i] = 0.15;
    map.Slope[i] = 0.001;
    if (isle === "mainland") {
      map.GrassSeed[i] = map.BroadleafSeed[i] = 0.2;
      map.GrassCover[i] = map.BroadleafCover[i] = 0.4;
      updateTreeCover(map, i);
    }
  }
  return map;
}
function on(map: PhysicalField, name: keyof typeof islands) {
  const [low, high] = islands[name];
  return Array.from(map.mesh.x.keys()).filter((i) => {
    const x = map.mesh.x[i] + map.mesh.origin[0];
    return i < map.mesh.contentCount && x > low + 10_000 && x < high - 10_000;
  });
}
const arrival = (map: PhysicalField, group: string, name: keyof typeof islands) => {
  const front = dispersePlants(map, 1000, () => neutralEcology).find(
    (item) => item.group.id === group
  )!.front;
  return Math.min(...on(map, name).map((i) => front.time[i]));
};

it("carries propagules across the sea, sooner downwind, and leaves remote islands treeless longer", () => {
  const map = archipelago();
  expect(arrival(map, "grass", "downwind")).toBeLessThan(arrival(map, "grass", "upwind") / 2);
  expect(arrival(map, "grass", "downwind")).toBeLessThan(100);
  expect(arrival(map, "grass", "remote")).toBeLessThan(500);
  expect(arrival(map, "broadleaf", "remote")).toBeGreaterThan(500);
});

it("lets grazers found a population on a nearby island with forage", () => {
  const map = archipelago();
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 0) continue;
    map.GrassCover[i] = 0.5;
    map.Productivity[i] = 1;
  }
  for (const i of on(map, "mainland")) map.Grazers[i] = 0.01;
  evolveAnimals(map, 300, () => neutralEcology);
  expect(on(map, "downwind").some((i) => map.Grazers[i] > 0)).toBe(true);
});

it("colonises a supplied island that emerges after the mainland is already established", () => {
  const map = archipelago(["mainland"]);
  evolveVegetation(map, 1000);
  const island = on(map, "downwind");
  expect(island.length).toBeGreaterThan(0);
  for (const i of island) {
    expect(map.WaterKindCodes[i]).toBe(1);
    map.WaterKindCodes[i] = 0;
    map.WaterDepths[i] = 0;
    map.Elevation[i] = units(100);
    map.DrainageElevations[i] = map.Elevation[i];
  }
  evolveVegetation(map, 5000);
  const occupied = island.filter(
    (i) => map.TreeCover[i] + map.GrassCover[i] + map.WetlandCover[i] > 0.12
  );
  expect(occupied.length / island.length).toBeGreaterThan(0.5);
});

it("makes frequently flooded ground wetter, younger and less wooded", () => {
  const map = archipelago(["mainland"]);
  for (let i = 0; i < map.mesh.count; i++) {
    if (map.WaterKindCodes[i] !== 0) continue;
    map.WetlandSeed[i] = map.ConiferSeed[i] = 0.2;
    map.Runoff[i] = 400;
    map.Seasonality[i] = 15;
    map.FloodplainIntensity[i] = map.mesh.y[i] > 0 ? 1000 : 0;
  }
  evolveVegetation(map, 800);
  const mean = (values: import("@atlas/domain").NumericalVector, flooded: boolean) => {
    const cells = on(map, "mainland").filter((i) => map.mesh.y[i] > 0 === flooded);
    return cells.reduce((sum, i) => sum + values[i], 0) / cells.length;
  };
  expect(mean(map.TreeCover, true)).toBeLessThan(mean(map.TreeCover, false) * 0.7);
  expect(mean(map.WetlandCover, true)).toBeGreaterThan(mean(map.WetlandCover, false));
  expect(mean(map.CanopyAge, true)).toBeLessThan(mean(map.CanopyAge, false));
});

it("lets floods eradicate island trees, which return only by crossing", () => {
  const isolated = archipelago(["downwind"]),
    reachable = archipelago(["mainland", "downwind"]);
  for (const map of [isolated, reachable]) {
    // The whole island floods, edges included, then the floods stop.
    const island = Array.from(map.mesh.x.keys()).filter((i) => map.WaterKindCodes[i] === 0);
    const downwind = (i: number) => map.mesh.x[i] + map.mesh.origin[0] > 200_000;
    for (const i of island.filter(downwind)) {
      map.BroadleafCover[i] = 0.4;
      map.BroadleafSeed[i] = 0.2;
      map.Runoff[i] = 400;
      map.Seasonality[i] = 15;
      map.FloodplainIntensity[i] = 1000;
    }
    for (let pass = 0; pass < 4; pass++) floodEcology(map, 1000);
    evolveVegetation(map, 1000);
    for (const i of island.filter(downwind)) map.FloodplainIntensity[i] = 0;
    floodEcology(map, 0);
    evolveVegetation(map, 1000);
  }
  const trees = (map: PhysicalField) =>
    Math.max(...on(map, "downwind").map((i) => map.BroadleafCover[i]));
  expect(trees(isolated)).toBeLessThan(0.01);
  expect(trees(reachable)).toBeGreaterThan(0.1);
});
