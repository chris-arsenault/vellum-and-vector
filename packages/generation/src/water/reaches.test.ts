import { expect, it } from "vitest";
import { addReach } from "./reachEvolution";
import { emptyReaches, reachMonths, reachOfCells, regimeOf } from "./reaches";

it("indexes a running course before an overlapping dry one and retains its profile position", () => {
  const store = emptyReaches(),
    dry = addReach(store, [1, 2, 3]),
    running = addReach(store, [3, 4]);
  dry.dry = true;
  dry.order = 5;
  const index = reachOfCells(store);
  expect(index.get(2)).toBe(dry);
  expect(index.get(3)).toBe(running);
  expect(index.position(4)).toBe(1);
  expect(index.get(99)).toBeUndefined();
});

it("reads months at the requested point rather than a course-wide summary", () => {
  const reach = addReach(emptyReaches(), [1, 2]);
  reach.monthly.fill(40, 0, 6);
  expect(reachMonths(reach, 0)).toBe(6);
  expect(reachMonths(reach, 1)).toBe(0);
});

it("prefers water at the shared point over a losing river's dry tail", () => {
  const store = emptyReaches(),
    losing = addReach(store, [1, 2]),
    running = addReach(store, [2, 3]);
  losing.order = 3;
  losing.monthly.fill(40, 0, 12);
  running.monthly.fill(20);
  expect(reachOfCells(store).get(2)).toBe(running);
});

it("states dry, seasonal and perennial regimes", () => {
  expect(regimeOf({ dry: true, months: 12 })).toBe("dry");
  expect(regimeOf({ dry: false, months: 6 })).toBe("seasonal");
  expect(regimeOf({ dry: false, months: 12 })).toBe("perennial");
});
