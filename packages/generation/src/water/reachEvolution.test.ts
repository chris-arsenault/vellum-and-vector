import { expect, it } from "vitest";
import { addReach, advanceReaches, type RiverEnvironment } from "./reachEvolution";
import { emptyReaches } from "./reaches";

function environment(targets: number[], resolved = targets.map(() => true)): RiverEnvironment {
  return {
    count: targets.length,
    order: Int32Array.from(targets.keys()),
    next: (cell) => targets[cell],
    land: () => true,
    resolved: (cell) => resolved[cell],
    flow: (_cell, month) => (month < 6 ? 40 : 0),
    bed: (cell) => 100 - cell,
    catchment: () => 100,
    discharge: 10,
    epoch: 0,
  };
}

it("updates the same retained reach and owns each month's water and its physical bed", () => {
  const store = emptyReaches(),
    env = environment([1, 2, -1]);
  advanceReaches(store, env);
  const before = store.reaches.get(1)!;
  advanceReaches(store, { ...env, flow: () => 20 });
  expect(store.reaches.get(1)).toBe(before);
  expect(before.cells).toEqual([0, 1, 2]);
  expect(Array.from(before.bed)).toEqual([100, 99, 98]);
  expect(Array.from(before.monthly.subarray(0, 12))).toEqual(Array(12).fill(20));
  expect(before.months).toBe(12);
});

it("retains the same river's dry bed and identity when no resolved water remains", () => {
  const store = emptyReaches();
  advanceReaches(store, environment([1, 2, -1]));
  const before = store.reaches.get(1)!;
  before.river = "long-river";
  advanceReaches(store, environment([1, 2, -1], [false, false, false]));
  expect(store.reaches.get(1)).toBe(before);
  expect(before.dry).toBe(true);
  expect(before.cells).toEqual([0, 1, 2]);
  expect(before.river).toBe("long-river");
  expect(before.flow).toBe(0);
});

it("changes only the diverted part and leaves its former course on the same reach", () => {
  const store = emptyReaches();
  advanceReaches(store, environment([1, 2, -1, -1], [true, true, true, false]));
  const before = store.reaches.get(1)!;
  advanceReaches(store, environment([1, 3, -1, -1], [true, true, false, true]));
  expect(store.reaches.get(1)).toBe(before);
  expect(before.cells).toEqual([0, 1, 3]);
  expect(before.former).toEqual([{ cells: [1, 2], leftIn: 0 }]);
  advanceReaches(store, environment([1, 2, -1, -1], [true, true, true, false]));
  expect(before.former).toEqual([{ cells: [1, 3], leftIn: 0 }]);
});

it("keeps a losing river's wet head when its downstream end has no water", () => {
  const store = emptyReaches(),
    env = environment([1, 2, -1]);
  advanceReaches(store, env);
  const before = store.reaches.get(1)!;
  before.river = "losing-river";
  advanceReaches(store, { ...env, flow: (cell) => (cell === 0 ? 20 : 0) });
  expect(store.reaches.get(1)).toBe(before);
  expect(before.dry).toBe(false);
  expect(before.flow).toBe(0);
  expect(before.monthly[0]).toBe(20);
  expect(before.monthly[24]).toBe(0);
});

it("leaves a named dry bed in place when drainage changes without returning water", () => {
  const store = emptyReaches();
  advanceReaches(store, environment([1, 2, -1, -1], [true, true, true, false]));
  const reach = store.reaches.get(1)!;
  reach.river = "old-river";
  advanceReaches(store, { ...environment([1, 3, -1, -1]), flow: () => 0 });
  expect(reach.cells).toEqual([0, 1, 2]);
  expect(reach.dry).toBe(true);
  expect(store.reaches.size).toBe(1);
});

it("splits a retained river at a new confluence while keeping its named lower end", () => {
  const store = emptyReaches();
  advanceReaches(store, environment([2, 2, 3, -1], [true, false, true, true]));
  const before = store.reaches.get(1)!;
  before.river = "long-river";
  advanceReaches(store, environment([2, 2, 3, -1]));
  expect(store.reaches.get(1)).toBe(before);
  expect(before.cells).toEqual([2, 3]);
  expect(before.order).toBe(2);
  expect([...store.reaches.values()].filter((reach) => reach.downstream === 1)).toHaveLength(2);
});

it("realizes initial tributaries from supplied latent channel origins, leaving dry country unclaimed", () => {
  const store = emptyReaches(),
    env = { ...environment([2, 3, -1, -1]), newHead: (cell: number) => cell === 0 };
  advanceReaches(store, env);
  expect([...store.reaches.values()].map((reach) => reach.cells)).toEqual([[0, 2]]);
});

it.each([false, true])(
  "splits an existing receiving course when a retained river diverts into its middle (named: %s)",
  (named) => {
    const store = emptyReaches(),
      diverted = addReach(store, [0, 1]),
      receiving = addReach(store, [2, 3, 4]),
      env = environment([1, 3, 3, 4, -1]);
    if (named) {
      diverted.river = "tributary";
      receiving.river = "main-river";
    }
    advanceReaches(store, env);
    expect(receiving.cells).toEqual([3, 4]);
    expect(diverted.downstream).toBe(receiving.id);
    for (const reach of store.reaches.values())
      for (let at = 1; at < reach.cells.length; at++)
        expect(env.next(reach.cells[at - 1])).toBe(reach.cells[at]);
  }
);
