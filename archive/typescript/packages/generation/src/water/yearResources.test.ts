import { expect, it } from "vitest";
import {
  createAdaptiveField,
  createAdaptiveTopology,
  generateChannel,
  putChannel,
  rectangle,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { noWaterSurface } from "../world/math";
import { inheritWaterState, waterStateChannels } from "./columnResources";

it("imports the established supply year independently of its empty ending snow store", () => {
  const source = createAdaptiveField(
    "supplied-year",
    { ...landscape().domain.scope, footprint: rectangle([0, 0, 1000, 1000]) },
    createAdaptiveTopology([0, 0, 1000, 1000], {
      maximumSize: 250,
      minimumSize: 250,
      refine: () => false,
    })
  );
  for (const { name, unit } of waterStateChannels) {
    const value =
      name === "SurfaceWaterMonth0"
        ? 120
        : name === "WaterRecharge"
          ? 9
          : name === "WaterSurfaceElevations"
            ? noWaterSurface
            : 0;
    putChannel(
      source,
      name,
      unit,
      generateChannel(source, name, () => value)
    );
  }
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0));
  inheritWaterState(map, source, new Map());
  expect(map.SnowPack.get(0)).toBe(0);
  expect(map.SurfaceWaterMonth0.get(0)).toBe(120);
  expect(map.SurfaceWaterMonth1.get(0)).toBe(0);
  expect(map.WaterRecharge.get(0)).toBe(9);
});
