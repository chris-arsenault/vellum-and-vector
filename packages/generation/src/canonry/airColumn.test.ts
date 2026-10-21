import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { atmosphericFlow } from "./atmosphere";
import { moisture, precipitation } from "./climate";
import { units } from "./math";

// Ocean west of x = −1,000 km, then land rising to a 3,000 m north–south range
// at x = 0, in the westerlies at the map's mid latitude.
function continent(heat?: (x: number) => number) {
  const map = createField(
    createWorldMesh([-1_400_000, -400_000, 1_400_000, 400_000], 9000, 50_000)
  );
  const c = physicalContext(42, 0, atlasPhysicalProfile());
  c.Profile.CirculationWander = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x[i],
      sea = x < -1_000_000;
    map.WaterKindCodes[i] = sea ? 1 : 0;
    map.WaterDepths[i] = sea ? units(3000) : 0;
    map.Elevation[i] = units(sea ? -3000 : 100 + 3000 * Math.exp(-((x / 80_000) ** 2)));
    map.Temperature[i] = 450;
    map.ExternalHeatForcing[i] = heat?.(x) ?? 0;
  }
  atmosphericFlow(map, c);
  moisture(map, c);
  precipitation(map, c);
  return map;
}
function along(map: PhysicalField, values: ArrayLike<number>, x: number) {
  let total = 0,
    count = 0;
  for (let i = 0; i < map.mesh.contentCount; i++)
    if (Math.abs(map.mesh.x[i] - x) < 20_000 && Math.abs(map.mesh.y[i]) < 150_000) {
      total += values[i];
      count++;
    }
  return total / count;
}
const total = (map: PhysicalField) =>
  Float64Array.from(map.Rainfall, (rain, i) => rain + map.Snowfall[i]);

it("rains out inland, wrings out a windward range and leaves a long lee shadow", () => {
  const map = continent(),
    rain = total(map);
  const coast = along(map, rain, -950_000),
    inland = along(map, rain, -450_000),
    windward = along(map, rain, -60_000),
    lee = along(map, rain, 120_000),
    far = along(map, rain, 300_000);
  expect(coast).toBeGreaterThan(inland);
  expect(windward).toBeGreaterThan(inland);
  expect(lee).toBeLessThan(windward / 2);
  // The shadow persists beyond the former 180 km trace.
  expect(far).toBeLessThan(inland * 0.8);
  expect(along(map, map.Moisture, -450_000)).toBeGreaterThan(along(map, map.Moisture, 300_000));
});

it("carries magical heat downwind of its source", () => {
  const base = continent(),
    heated = continent((x) => (Math.abs(x + 500_000) < 30_000 ? 200 : 0));
  const change = (x: number) =>
    along(heated, heated.Temperature, x) - along(base, base.Temperature, x);
  expect(change(-300_000)).toBeGreaterThan(5);
  expect(change(-700_000)).toBeLessThan(1);
});

it("makes the interior more seasonal than the coast", () => {
  const map = continent();
  expect(along(map, map.Seasonality, 500_000)).toBeGreaterThan(
    along(map, map.Seasonality, -900_000) * 1.3
  );
});
