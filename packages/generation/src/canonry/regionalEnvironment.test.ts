import { expect, it } from "vitest";
import { downscaleRegionalClimate } from "./regionalClimate";
import { refineRegionalMagic } from "./regionalMagic";
import { projectMagic, classifyMagicFeatures } from "./magicFeatures";
import { regionalEnvironmentFixture } from "./regionalEnvironmentFixture";

it("downscales colder and snowier high ground without changing the parent's climate or ecological age", () => {
  const { state, map, parent } = regionalEnvironmentFixture(),
    climate = parent.channels.temperature.slice(),
    age = map.CanopyAge.slice(),
    middle = Math.floor(map.mesh.count / 2);
  map.Elevation[middle] += 2000 * 1024;
  downscaleRegionalClimate(state, 19);
  expect(map.Temperature[middle]).toBe(270);
  expect(map.Snowfall[middle]).toBeGreaterThan(map.Snowfall[0]);
  expect(map.Rainfall[middle]).toBeLessThan(map.Rainfall[0]);
  expect(map.Temperature[0]).toBe(400);
  expect(map.CanopyAge).toEqual(age);
  expect(parent.channels.temperature).toEqual(climate);
});
it("refines seven distinct influences without creating stock or repeating their historical events", () => {
  const { state, map, parent } = regionalEnvironmentFixture(),
    original = structuredClone(parent.channels),
    age = map.CanopyAge.slice();
  refineRegionalMagic(state, 19);
  const fields = state.physical!.magic!.fields;
  expect(fields.map((field) => field.definition.id)).toHaveLength(7);
  for (const field of fields) {
    for (const values of Object.values(field.stocks))
      expect(values.reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(12_000_000, 4);
    expect(field.history.every((value) => value === 400)).toBe(true);
    expect(field.firstEpoch.every((value) => value === 2)).toBe(true);
    expect(field.lost).toBe(0);
  }
  const pressure = fields.find((field) => field.definition.id === "pressure")!;
  expect(pressure.intensity.every((value) => value === 200)).toBe(true);
  classifyMagicFeatures(state, 19);
  projectMagic(state);
  expect(state.surface.quantities!["magic:fire:stock:vein/held"]).toBe("extensive");
  expect(state.surface.channels["magic:fire:origin:vein:source"].some((value) => value > 0)).toBe(
    true
  );
  expect(map.CanopyAge).toEqual(age);
  expect(map.events).toEqual([]);
  expect(map.CompletedEpochCount).toBe(0);
  expect(parent.channels).toEqual(original);
});
it("does not materialize an absent system or its confluences when refining a nonmagical scene", () => {
  const { state } = regionalEnvironmentFixture(false);
  refineRegionalMagic(state, 19);
  classifyMagicFeatures(state, 19);
  for (const field of state.physical!.magic!.fields) {
    expect(field.intensity.every((value) => value === 0)).toBe(true);
    expect(field.source.every((value) => value === 0)).toBe(true);
  }
  expect(Object.keys(state.physical!.magic!.confluences.states)).toEqual([]);
});
