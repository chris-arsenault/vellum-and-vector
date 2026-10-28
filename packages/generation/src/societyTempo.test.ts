import { expect, it } from "vitest";
import { createGrid, putChannel, rectangle, residentBand } from "@atlas/domain";
import { landscape, epoch } from "./mapFixtures";
import { randomStream } from "./random";
import type { MapProcessContext } from "./process";
import { initializePopulation } from "./societyPopulation";
import { evolveSociety } from "./societyEvolution";
import { roundCycle, settledCycle, societyStep } from "./societyTempo";

function fixture() {
  const state = landscape();
  state.domain.world.id = "bc07dcd0-7cba-46b1-8e56-5f7829dde8cb";
  const footprint = rectangle([0, 0, 300000, 100000]);
  state.domain.scope.footprint = footprint;
  state.domain.world.areas.area.footprint = footprint;
  state.surface = createGrid("society", state.domain.scope, 25, 9);
  const set = (name: string, value: number) =>
    putChannel(
      state.surface,
      name,
      "ratio",
      residentBand("float64", new Float64Array(225).fill(value))
    );
  set("elevation", 100);
  set("temperature", 18);
  set("moisture", 0.7);
  set("treeCover", 0);
  const random = randomStream("7", "society", "tempo", "test", []);
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [epoch("Settlement", 200, { mobility: 1 })],
    epochIndices: [0],
    causes: [],
    recordCause() {},
    random: () => random.next(),
    cancelled: () => false,
    progress() {},
  };
  initializePopulation(state, context);
  return { state, context };
}
function fill(state: ReturnType<typeof fixture>["state"], share: number) {
  for (const c of state.society!.region.communities)
    c.groups = [{ ...c.groups[0], count: c.support.capacity * share }];
}

it("steps by the decade while the land has room and by the lifetime once it is full", () => {
  const { state } = fixture();
  fill(state, 0.05);
  const founding = societyStep(state, 10000, settledCycle);
  fill(state, 0.5);
  const growing = societyStep(state, 10000, settledCycle);
  fill(state, 0.98);
  const full = societyStep(state, settledCycle.max * 10, settledCycle);
  expect(founding).toBeGreaterThanOrEqual(settledCycle.min);
  expect(founding).toBeLessThan(growing);
  expect(growing).toBeLessThan(full);
  expect(full).toBe(settledCycle.max);
  fill(state, 0.05);
  expect(societyStep(state, 10000, roundCycle)).toBeGreaterThanOrEqual(roundCycle.min);
});

it("splits the remaining years evenly and never leaves a sliver", () => {
  const { state } = fixture();
  fill(state, 0.98);
  const { max } = settledCycle;
  expect(societyStep(state, max + 5, settledCycle)).toBeCloseTo((max + 5) / 2, 9);
  expect(societyStep(state, 7, settledCycle)).toBe(7);
  for (const c of state.society!.region.communities) c.groups = [];
  expect(societyStep(state, 1000, settledCycle)).toBeCloseTo(1000 / Math.ceil(1000 / max), 9);
});

it("covers an era exactly with cycles the pace of change decides", async () => {
  const { state, context } = fixture();
  const years: number[] = [];
  await evolveSociety(
    state,
    { ...context, progress: (_f, message) => years.push(Number(/year (\d+)/.exec(message)![1])) },
    200
  );
  const record = state.society!.region.history[0];
  expect(record.years).toBeCloseTo(200, 6);
  expect(record.cycles).toBe(years.length);
  expect(years.at(-1)).toBe(200);
  expect(record.cycles).toBeGreaterThanOrEqual(Math.ceil(200 / settledCycle.max));
  expect(record.cycles).toBeLessThanOrEqual(Math.ceil(200 / settledCycle.min));
});
