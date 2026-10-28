import { expect, it } from "vitest";
import type { Band } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { physicalContext } from "./context";
import { precipitation, runoff, temperature } from "./climate";
import { glacialRunoff } from "./glacialEvolution";
import { floodEcology } from "./ecologyDisturbance";
import { warmthSources } from "./warmth";
import { seaIce } from "./seaIce";
import { atlasPresets, rainfallRegimes } from "../atlasParameters";
import { domainCartography } from "../domainCartography";
import { units } from "./math";

// Flat lowland and open sea at one latitude, with given crustal and current heat.
function surface(geothermal: number, currentHeat: number) {
  const map = createField(createWorldMesh([-200_000, -200_000, 200_000, 200_000], 400, 20_000));
  const c = physicalContext(7, 0, atlasPhysicalProfile());
  for (let i = 0; i < map.mesh.count; i++) {
    const sea = map.mesh.x(i) < 0;
    map.WaterKindCodes.set(i, sea ? 1 : 0);
    map.Elevation.set(i, units(sea ? -2000 : 50));
    map.Geothermal.set(i, geothermal);
    map.OceanCurrentHeat.set(i, sea ? currentHeat : 0);
    map.OceanCurrentStrength.set(i, sea ? 800 : 0);
  }
  warmthSources(map, c);
  temperature(map, c);
  return map;
}
const spread = (a: Band, b: Band) => {
  let largest = -Infinity;
  for (let i = 0; i < a.length; i++) largest = Math.max(largest, Math.abs(a.get(i) - b.get(i)));
  return largest;
};

it("leaves ridge and fracture heat out of surface temperature", () => {
  // A plate-boundary ridge below vent intensity carrying hydrothermal heat on its current.
  expect(spread(surface(600, 540).Temperature, surface(0, 60).Temperature)).toBe(0);
});

it("warms vents and active volcanoes by a few degrees at most", () => {
  const warming = spread(surface(1000, 60).Temperature, surface(0, 60).Temperature);
  expect(warming).toBeGreaterThan(0);
  expect(warming).toBeLessThanOrEqual(30);
});

it("freezes an exposed polar sea that averages well below freezing", () => {
  const frozen = (celsius: number) => {
    const map = createField(createWorldMesh([0, 0, 200_000, 200_000], 200, 20_000));
    const c = physicalContext(7, 0, atlasPhysicalProfile());
    for (let i = 0; i < map.mesh.count; i++) {
      map.WaterKindCodes.set(i, 1);
      map.Temperature.set(i, 300 + celsius * 10);
      // Strong current, full wave fetch and background hydrothermal heat.
      map.OceanCurrentStrength.set(i, 1000);
      map.WaveExposure.set(i, 1000);
      map.OceanCurrentHeat.set(i, 60);
    }
    seaIce(map, c);
    const cells = Array.from({ length: map.mesh.count }, (_, i) => i).filter(
      (i) => map.mesh.membership(i) === 1
    );
    return cells.filter((i) => map.IceThickness.get(i) > 0).length / cells.length;
  };
  expect(frozen(-12)).toBe(1);
  expect(frozen(2)).toBe(0);
});

it("keeps tropical rain above a metre and clips only at the precipitation ceiling", () => {
  const rain = (column: number) => {
    const map = surface(0, 60);
    const c = physicalContext(7, 0, atlasPhysicalProfile());
    map.ColumnPrecipitation.fill(column);
    map.Temperature.fill(550);
    map.Seasonality.fill(5);
    precipitation(map, c);
    return map.Rainfall.get(0) + map.Snowfall.get(0);
  };
  const p = atlasPhysicalProfile();
  expect(rain(2400)).toBe(p.PrecipitationBaseline + 2400);
  expect(rain(9000)).toBe(p.PrecipitationCeiling);
});

it("passes tropical rain to rivers and floods without a one-metre clip", () => {
  const c = physicalContext(7, 0, atlasPhysicalProfile());
  const land = (rain: number) => {
    const map = surface(0, 60);
    map.Rainfall.fill(rain);
    map.Temperature.fill(550);
    map.Seasonality.fill(10);
    map.FloodplainIntensity.fill(1000);
    runoff(map, c);
    return map;
  };
  const wet = land(3000);
  let i = -1;
  for (let cellIndex = 0; cellIndex < wet.mesh.count && i < 0; cellIndex++)
    if (wet.mesh.membership(cellIndex) !== 0 && wet.WaterKindCodes.get(cellIndex) === 0)
      i = cellIndex;
  // Warm, wet land loses part of its rain and runs the rest off, above a metre.
  expect(wet.Runoff.get(i)).toBeGreaterThan(1000);
  expect(wet.Runoff.get(i)).toBeLessThan(3000);
  wet.GlacialMeltwater.fill(5000);
  glacialRunoff(wet, c);
  expect(wet.Runoff.get(i)).toBe(c.Profile.PrecipitationCeiling);
  floodEcology(wet, 1000);
  let floodiest = -Infinity;
  for (let cellIndex = 0; cellIndex < wet.mesh.count; cellIndex++)
    floodiest = Math.max(floodiest, wet.FloodFrequency.get(cellIndex));
  expect(floodiest).toBeLessThanOrEqual(0.5);
});

it("carries the rainfall setting as moisture supply, from one regime table", () => {
  const base = atlasPhysicalProfile(),
    wet = atlasPhysicalProfile({ rainfall: 2 });
  expect(wet.ColumnSaturation).toBe(base.ColumnSaturation * 2);
  expect(wet.ColumnRainEfficiency).toBe(base.ColumnRainEfficiency);
  const regime = domainCartography["ecology.living"];
  expect(
    regime.choices.map((item) => item.features["physical.climate"].settings?.rainfall)
  ).toEqual([
    rainfallRegimes.dry.rainfall,
    rainfallRegimes.mixed.rainfall,
    rainfallRegimes.mixed.rainfall,
    rainfallRegimes.wet.rainfall,
  ]);
  expect(atlasPresets.arid.parameters.rainfall).toBe(rainfallRegimes.dry.rainfall);
  expect(atlasPresets.wet.parameters.rainfall).toBe(rainfallRegimes.wet.rainfall);
});

it("paints no Canonry warmth pockets on an atlas map", () => {
  const map = surface(0, 60);
  let painted = false;
  for (let i = 0; i < map.mesh.count; i++) if (map.Warmth.get(i) !== 0) painted = true;
  expect(painted).toBe(false);
});
