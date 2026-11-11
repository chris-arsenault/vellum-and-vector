import { expect, it } from "vitest";
import { MapScale } from "@atlas/domain";
import { atlasPhysicalProfile } from "../world/atlasProfile";
import { physicalContext } from "../world/context";
import { canonicalPhysicalFields } from "@atlas/domain";
import { createTestField } from "../rock/groundTestFixture";
import { units } from "../world/math";
import { createWorldMesh } from "../world/worldMesh";
import { ask, explainAnswer } from "./answers";
import { invalidateProcesses } from "../processOperation";
import { flowRecord } from "./flows";
import { quantityKinds } from "./quantities";
import "./responders";
import { Stage } from "./stage";

const field = () => createTestField(createWorldMesh([0, 0, 1_000_000, 1_000_000], 16, 0));
const context = () => physicalContext(1, 0, atlasPhysicalProfile({}, {}, MapScale.reference()));

it("gives every band a kind, so nothing is left behind when plates move", () => {
  const missing = canonicalPhysicalFields()
    .map(({ name }) => name)
    .filter((name) => !quantityKinds[name]);
  expect(missing).toEqual([]);
});

it("lets rain reach rivers: wetter ground answers with more water", () => {
  const map = field(),
    c = context();
  map.Runoff.set(0, 100);
  map.Runoff.set(1, 400);
  const discharge = ask(map, "discharge", c);
  expect(discharge.get(1)).toBeCloseTo(discharge.get(0) * 4);
});

it("holds an answer until the world moves, then answers afresh", () => {
  const map = field(),
    c = context();
  map.Runoff.set(0, 100);
  const before = ask(map, "discharge", c).get(0);
  map.Runoff.set(0, 300);
  expect(ask(map, "discharge", c).get(0)).toBe(before);
  invalidateProcesses(map);
  expect(ask(map, "discharge", c).get(0)).toBeCloseTo(before * 3);
});

it("lets magic change an answer in its own terms without any process knowing", () => {
  const map = field(),
    c = context();
  map.Temperature.fill(500);
  const plain = ask(map, "warmth", c).get(0);
  map.Quickening.fill(1);
  invalidateProcesses(map);
  expect(ask(map, "warmth", c).get(0)).toBeCloseTo(plain * 2);
});

it("explains current responder contributions without changing a group's cached inputs", () => {
  const map = field(),
    c = context();
  map.Temperature.set(0, 500);
  const initial = ask(map, "warmth", c).get(0);
  map.Quickening.set(0, 1);
  const explained = explainAnswer(map, "warmth", 0, c);
  expect(explained.value).toBeCloseTo(initial * 2);
  expect(explained.contributions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ operation: "base" }),
      expect.objectContaining({ by: "fire", operation: "scale", value: 2 }),
    ])
  );
  expect(ask(map, "warmth", c).get(0)).toBe(initial);
  invalidateProcesses(map);
  expect(ask(map, "warmth", c).get(0)).toBe(explained.value);
});

it("rejects unsupported transfers instead of silently depositing loose material", () => {
  const stage = new Stage(field(), { simultaneous: false });
  expect(() => stage.demand("melt", "rock", 0, 1, "probe")).toThrow(
    "Unsupported stage transfer: melt -> rock"
  );
});

function standing(height: number) {
  const map = field();
  map.BedrockElevation.fill(units(height));
  map.Elevation.fill(units(height));
  map.EffectiveSeaLevel = 0;
  return map;
}
const streams = { id: "a", remembers: "CumulativeFluvialErosion" } as const,
  acid = { id: "b", remembers: "CumulativeFluvialErosion" } as const,
  ice = { id: "c", remembers: "CumulativeGlacialErosion", pastBaseLevel: true } as const;

it("changes nothing until a stage settles, then lands everyone's demands", () => {
  const map = standing(100),
    stage = new Stage(map, { simultaneous: false });
  stage.wear(streams, 0, units(10));
  expect(map.Elevation.get(0)).toBe(units(100));
  stage.settle();
  expect(map.Elevation.get(0)).toBeCloseTo(units(90), -1);
});

it("shares out what is left above the sea when more is asked than can go", () => {
  const map = standing(10),
    stage = new Stage(map, { simultaneous: true });
  stage.wear(streams, 0, units(30));
  stage.wear(acid, 0, units(10));
  stage.settle();
  const left = (map.Elevation.get(0) - map.EffectiveSeaLevel) / 1024;
  expect(left).toBeGreaterThanOrEqual(0.9);
  expect(left).toBeLessThan(1.2);
  const moved = Object.fromEntries(flowRecord(map).map((one) => [one.cause, one.volume]));
  expect(moved.a / moved.b).toBeCloseTo(3, 1);
});

it("lets ice cut below the sea where water cannot", () => {
  const map = standing(10),
    stage = new Stage(map, { simultaneous: false });
  stage.wear(ice, 0, units(50));
  stage.settle();
  expect(map.Elevation.get(0)).toBeLessThan(0);
});
