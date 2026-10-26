import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { atmosphericFlow } from "./atmosphere";
import { moisture, precipitation, runoff, temperature } from "./climate";
import { units } from "./math";
import { rainfallRegimes } from "../atlasParameters";

function flatWorld(southLatitude: number, northLatitude: number) {
  const map = createField(createWorldMesh([0, 0, 400_000, 600_000], 256, 0));
  const profile = atlasPhysicalProfile({ southLatitude, northLatitude });
  profile.WorldExtentY = [0, 600_000];
  profile.CirculationWander = 0;
  map.Elevation.fill(units(100));
  const context = physicalContext(73, 0, profile);
  return { map, context };
}
it.each([
  [-90, 90],
  [-70, 70],
  [10, 70],
  [40, 85],
])(
  "cools constructed flat terrain poleward across %i..%i without generating continents",
  (south, north) => {
    const { map, context } = flatWorld(south, north);
    temperature(map, context);
    const cells = Array.from({ length: map.mesh.contentCount }, (_, i) => i);
    const equatorward = cells.reduce((best, i) =>
      map.Temperature[i] > map.Temperature[best] ? i : best
    );
    const poleward = cells.reduce((best, i) =>
      map.Temperature[i] < map.Temperature[best] ? i : best
    );
    expect(map.Temperature[equatorward] - map.Temperature[poleward]).toBeGreaterThan(100);
    if (south === -north) {
      const lower = cells.filter((i) => map.mesh.y[i] < -200_000);
      const upper = cells.filter((i) => map.mesh.y[i] > 200_000);
      const mean = (indices: number[]) =>
        indices.reduce((sum, i) => sum + map.Temperature[i], 0) / indices.length;
      expect(mean(lower)).toBeCloseTo(mean(upper), 0);
    }
  }
);

function rainfall(rainfall: number) {
  const { map, context } = flatWorld(10, 70);
  context.Profile = atlasPhysicalProfile({ rainfall, latitudeProjection: 0 });
  context.Profile.CirculationWander = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const ocean = map.mesh.x[i] < -100_000;
    map.WaterKindCodes[i] = ocean ? 1 : 0;
    map.WaterDepths[i] = ocean ? units(1000) : 0;
    map.Elevation[i] = units(ocean ? -1000 : 100);
    map.Temperature[i] = 450;
  }
  atmosphericFlow(map, context);
  moisture(map, context);
  precipitation(map, context);
  runoff(map, context);
  const total = (values: ArrayLike<number>) => {
    let sum = 0;
    for (let i = 0; i < map.mesh.contentCount; i++)
      if (map.WaterKindCodes[i] === 0) sum += values[i] * map.mesh.contentAreas[i];
    return sum;
  };
  return { rain: total(map.Rainfall) + total(map.Snowfall), runoff: total(map.Runoff) };
}
it("changes rain and river supply on the same constructed coast under Dry, Mixed and Wet", () => {
  const [dry, mixed, wet] = ["dry", "mixed", "wet"].map((id) =>
    rainfall(rainfallRegimes[id as keyof typeof rainfallRegimes].rainfall)
  );
  expect(dry.rain).toBeGreaterThan(0);
  expect(dry.rain).toBeLessThan(mixed.rain);
  expect(mixed.rain).toBeLessThan(wet.rain);
  expect(dry.runoff).toBeLessThan(mixed.runoff);
  expect(mixed.runoff).toBeLessThan(wet.runoff);
});
