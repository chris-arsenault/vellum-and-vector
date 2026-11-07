import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { physicalContext } from "../world/context";
import { createField, type PhysicalField } from "../world/field";
import { units } from "../world/math";
import { rebuild } from "../world/surface";
import { createWorldMesh } from "../world/worldMesh";
import { setLayer } from "../rock/rockColumn";
import { rockCatalogue } from "../rock/rockCatalogue";
import { creep } from "./creep";
import { actBy } from "./processCatalogue";
import { slopes } from "./slopes";
import { weathering } from "./weathering";

function land(height: (x: number) => number): PhysicalField {
  const map = createField(createWorldMesh([0, 0, 800_000, 800_000], 32, 0));
  map.EffectiveSeaLevel = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    setLayer(map, i, 0, rockCatalogue.shale.code, units(30_000));
    map.BedrockElevation.set(i, units(height(map.mesh.x(i))));
    map.SurfaceRockLoad.set(i, units(height(map.mesh.x(i))));
    rebuild(map, i);
  }
  return map;
}
const context = () => physicalContext(1, 0, atlasPhysicalProfile(), null, 0, 1);
const middleX = (map: PhysicalField) => {
  let total = 0;
  for (let i = 0; i < map.mesh.count; i++) total += map.mesh.x(i);
  return total / map.mesh.count;
};
function weathered(rain: number, temperature: number, mantle = 0) {
  const map = land(() => 1000);
  map.Runoff.fill(rain);
  map.Rainfall.fill(rain);
  map.Temperature.fill(temperature);
  map.SedimentThickness.fill(units(mantle));
  actBy(weathering)(map, context());
  return map.SedimentThickness.get(0) / 1024 - mantle;
}

it("weathers wet warm ground far more than dry or frozen ground", () => {
  const wet = weathered(600, 500);
  expect(wet).toBeGreaterThan(weathered(30, 500) * 5);
  expect(wet).toBeGreaterThan(weathered(600, 100) * 5);
});

it("slows weathering under a deep mantle, which shields the rock", () => {
  expect(weathered(600, 500, 200)).toBeLessThan(weathered(600, 500) / 10);
});

it("keeps the ground where it is when rock turns to loose cover", () => {
  const map = land(() => 1000);
  map.Runoff.fill(600);
  map.Temperature.fill(500);
  actBy(weathering)(map, context());
  expect(map.Elevation.get(0)).toBeCloseTo(units(1000), -1);
  expect(map.BedrockElevation.get(0)).toBeLessThan(units(1000));
});

it("moves loose cover downhill on a gentle slope that would never fail", () => {
  const make = () => {
    const map = land((x) => x / 1000);
    map.SedimentThickness.fill(units(50));
    for (let i = 0; i < map.mesh.count; i++) rebuild(map, i);
    return map;
  };
  const still = make();
  actBy(slopes)(still, context());
  const crept = make();
  actBy(creep)(crept, context());
  const high = (map: PhysicalField, at: number) => {
    let total = 0,
      count = 0;
    for (let i = 0; i < map.mesh.count; i++)
      if (map.mesh.x(i) > at) {
        total += map.SedimentThickness.get(i);
        count++;
      }
    return total / count / 1024;
  };
  const middle = middleX(crept);
  expect(high(crept, middle)).toBeLessThan(high(still, middle));
});

it("lets a very steep step fail until it stands, with nothing capping how much", () => {
  const map = land((x) => (x > 400_000 ? 12_000 : 0));
  actBy(slopes)(map, context());
  let steepest = 0;
  for (let i = 0; i < map.mesh.count; i++)
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (j >= 0)
        steepest = Math.max(steepest, Math.abs(map.Elevation.get(i) - map.Elevation.get(j)) / 1024);
    }
  expect(steepest).toBeLessThan(6000);
});
