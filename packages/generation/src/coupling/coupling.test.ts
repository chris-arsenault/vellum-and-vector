import { expect, it } from "vitest";
import { atlasPhysicalProfile } from "../canonry/atlasProfile";
import { physicalContext } from "../canonry/context";
import { createField, physicalSchema } from "../canonry/field";
import { units } from "../canonry/math";
import { createWorldMesh } from "../canonry/worldMesh";
import { ask, respondersTo, worldMoved } from "./answers";
import { answerRows, processRows } from "./couplingTable";
import { flowRecord } from "./flows";
import { quantityKinds } from "./quantities";
import { WearStage } from "./wearStage";

const field = () => createField(createWorldMesh([0, 0, 1_000_000, 1_000_000], 16, 0));
const context = () => physicalContext(1, 0, atlasPhysicalProfile());

it("gives every band a kind, so nothing is left behind when plates move", () => {
  const missing = physicalSchema()
    .map(({ name }) => name)
    .filter((name) => !quantityKinds[name]);
  expect(missing).toEqual([]);
});

it("has a base answer and an asker for every key", () => {
  for (const { key, answeredBy, askedBy } of answerRows()) {
    expect(answeredBy.length, key).toBeGreaterThan(0);
    expect(askedBy.length, key).toBeGreaterThan(0);
    expect(respondersTo(key).filter((one) => "base" in one)).toHaveLength(1);
  }
});

it("declares what each process reads, asks and moves", () => {
  for (const row of processRows()) {
    expect(row.moves.length, row.id).toBeGreaterThan(0);
    expect(row.reads.length + row.asks.length, row.id).toBeGreaterThan(0);
  }
});

it("lets rain reach rivers: wetter ground answers with more water", () => {
  const map = field(),
    c = context();
  map.Runoff.set(0, 100);
  map.Runoff.set(1, 400);
  const runoff = ask(map, "runoff", c);
  expect(runoff.get(1)).toBeCloseTo(runoff.get(0) * 4);
});

it("holds an answer until the world moves, then answers afresh", () => {
  const map = field(),
    c = context();
  map.Runoff.set(0, 100);
  const before = ask(map, "runoff", c).get(0);
  map.Runoff.set(0, 300);
  expect(ask(map, "runoff", c).get(0)).toBe(before);
  worldMoved(map);
  expect(ask(map, "runoff", c).get(0)).toBeCloseTo(before * 3);
});

it("lets magic change an answer in its own terms without any process knowing", () => {
  const map = field(),
    c = context();
  map.Temperature.fill(500);
  const plain = ask(map, "warmth", c).get(0);
  map.Quickening.fill(1);
  worldMoved(map);
  expect(ask(map, "warmth", c).get(0)).toBeCloseTo(plain * 2);
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
    stage = new WearStage(map);
  stage.demand(streams, 0, units(10));
  expect(map.Elevation.get(0)).toBe(units(100));
  stage.settle();
  expect(map.Elevation.get(0)).toBeCloseTo(units(90), -1);
});

it("shares out what is left above the sea when more is asked than can go", () => {
  const map = standing(10),
    stage = new WearStage(map);
  stage.demand(streams, 0, units(30));
  stage.demand(acid, 0, units(10));
  stage.settle();
  const left = (map.Elevation.get(0) - map.EffectiveSeaLevel) / 1024;
  expect(left).toBeGreaterThanOrEqual(0.9);
  expect(left).toBeLessThan(1.2);
  const moved = Object.fromEntries(flowRecord(map).map((one) => [one.cause, one.volume]));
  expect(moved.a / moved.b).toBeCloseTo(3, 1);
});

it("lets ice cut below the sea where water cannot", () => {
  const map = standing(10),
    stage = new WearStage(map);
  stage.demand(ice, 0, units(50));
  stage.settle();
  expect(map.Elevation.get(0)).toBeLessThan(0);
});
