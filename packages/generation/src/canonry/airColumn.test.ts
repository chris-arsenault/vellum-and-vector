import { expect, it } from "vitest";
import { Band } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createField, type PhysicalField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { atmosphericFlow } from "./atmosphere";
import { moisture, precipitation } from "./climate";
import { marchAirColumns } from "./airColumn";
import { units } from "./math";

// Ocean west of x = −1,000 km, then land rising to a 3,000 m north–south range
// at x = 0, in the westerlies at the map's mid latitude.
function continent(heat?: (x: number, y: number) => number, samples = 9000) {
  const map = createField(
    createWorldMesh([-1_400_000, -400_000, 1_400_000, 400_000], samples, 50_000)
  );
  // Mid latitude 40° with even degrees, in the westerlies.
  const c = physicalContext(42, 0, atlasPhysicalProfile({ latitudeProjection: 0 }));
  c.Profile.CirculationWander = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x(i),
      sea = x < -1_000_000;
    map.WaterKindCodes.set(i, sea ? 1 : 0);
    map.WaterDepths.set(i, sea ? units(3000) : 0);
    map.Elevation.set(i, units(sea ? -3000 : 100 + 3000 * Math.exp(-((x / 80_000) ** 2))));
    map.Temperature.set(i, 450);
    map.ExternalHeatForcing.set(i, heat?.(x, map.mesh.y(i)) ?? 0);
  }
  atmosphericFlow(map, c);
  moisture(map, c);
  precipitation(map, c);
  return map;
}
function along(
  map: PhysicalField,
  values: Band | ArrayLike<number>,
  x: number,
  y = 0,
  half = 150_000
) {
  const read = (i: number) => (values instanceof Band ? values.get(i) : values[i]);
  let total = 0,
    count = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (
      map.mesh.membership(i) === 1 &&
      Math.abs(map.mesh.x(i) - x) < 20_000 &&
      Math.abs(map.mesh.y(i) - y) < half
    ) {
      total += read(i);
      count++;
    }
  return total / count;
}
const total = (map: PhysicalField) =>
  Float64Array.from(
    { length: map.mesh.count },
    (_, i) => map.Rainfall.get(i) + map.Snowfall.get(i)
  );

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

it("carries no more than its share of uniform magical heat, at any resolution", () => {
  const warmed = (samples: number) => {
    const base = continent(undefined, samples),
      heated = continent(() => 200, samples);
    return (x: number) => along(heated, heated.Temperature, x) - along(base, base.Temperature, x);
  };
  const coarse = warmed(4000),
    fine = warmed(16_000);
  // MagicHeatAirShare 0.5 of a uniform 200 forcing.
  expect(fine(500_000)).toBeLessThan(105);
  expect(fine(500_000)).toBeGreaterThan(80);
  expect(Math.abs(fine(500_000) - coarse(500_000))).toBeLessThan(10);
});

it("spreads a narrow source's heat across the wind instead of drawing a streak", () => {
  const source = (x: number, y: number) =>
    Math.abs(x + 500_000) < 30_000 && Math.abs(y) < 20_000 ? 200 : 0;
  const base = continent(),
    heated = continent(source);
  const change = (y: number) =>
    along(heated, heated.Temperature, -400_000, y, 15_000) -
    along(base, base.Temperature, -400_000, y, 15_000);
  expect(change(0)).toBeGreaterThan(0.5);
  expect(change(60_000)).toBeGreaterThan(change(0) * 0.25);
});

it("lets subsiding air cap uplift rain on a windward range", () => {
  const map = continent(),
    c = physicalContext(42, 0, atlasPhysicalProfile({ latitudeProjection: 0 }));
  const windward = (rainout: number) =>
    along(map, marchAirColumns(map, c, () => rainout).precipitation, -60_000);
  // A tenfold drop in belt rainout cuts windward rain below 40 %, uplift included;
  // moister arriving air offsets part of the cut.
  expect(windward(0.1)).toBeLessThan(windward(1) * 0.4);
});

it("makes the interior more seasonal than the coast", () => {
  const map = continent();
  expect(along(map, map.Seasonality, 500_000)).toBeGreaterThan(
    along(map, map.Seasonality, -900_000) * 1.3
  );
});
