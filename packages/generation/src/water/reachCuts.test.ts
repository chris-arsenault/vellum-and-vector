import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { workingArray } from "../world/physicalNumerics";
import { createWorldMesh } from "../world/worldMesh";
import { cutReaches } from "./reachCuts";

/**
 * A small field of dry land with two chains of cells that drain into one trunk:
 * a → b → c → d and e → c, with d running into the sea cell s.
 */
function forked() {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 16, 0)),
    river = workingArray(map, "uint8", "test:river"),
    [a, b, c, d, e, s] = [0, 1, 2, 3, 4, 5];
  map.WaterKindCodes.fill(0);
  map.FlowTargets.fill(-1);
  map.FlowTargets.set(a, b);
  map.FlowTargets.set(b, c);
  map.FlowTargets.set(e, c);
  map.FlowTargets.set(c, d);
  map.FlowTargets.set(d, s);
  map.WaterKindCodes.set(s, 1);
  for (const cell of [a, b, c, d, e]) {
    river.set(cell, 1);
    map.RiverOrders.set(cell, cell === c || cell === d ? 2 : 1);
    map.FlowAccumulation.set(cell, 10 * (cell + 1));
    map.PerennialFlow.set(cell, cell + 1);
    map.FloodFlow.set(cell, 100 * (cell + 1));
    map.FlowingMonths.set(cell, 12);
  }
  return { map, river, a, b, c, d, e };
}

it("cuts rivers into reaches at their confluences, each linked to the one it runs into", () => {
  const { map, river, a, b, c, d, e } = forked(),
    cuts = cutReaches(map, river),
    of = (head: number) => cuts.find((cut) => cut.cells[0] === head)!;
  expect(cuts.map((cut) => cut.cells)).toEqual([[a, b], [c, d], [e]]);
  // Both heads run into the trunk; the trunk ends in the sea.
  expect(cuts[of(a).downstream!]).toBe(of(c));
  expect(cuts[of(e).downstream!]).toBe(of(c));
  expect(of(c).downstream).toBeNull();
  expect(of(c).order).toBe(2);
});

it("reads what a reach carries at its last cell", () => {
  const { map, river, a, b } = forked(),
    head = cutReaches(map, river).find((cut) => cut.cells[0] === a)!;
  expect(head.flow).toBe(map.FlowAccumulation.get(b));
  expect(head.least).toBe(map.PerennialFlow.get(b));
  expect(head.flood).toBe(map.FloodFlow.get(b));
  expect(head.months).toBe(12);
});

it("ends a reach where the river ends, with nothing below it", () => {
  const { map, river, c, d } = forked();
  // The trunk loses its water before the sea.
  river.set(d, 0);
  const trunk = cutReaches(map, river).find((cut) => cut.cells[0] === c)!;
  expect(trunk.cells).toEqual([c]);
  expect(trunk.downstream).toBeNull();
});

it("finds no reaches where no river runs", () => {
  const { map, river } = forked();
  river.fill(0);
  expect(cutReaches(map, river)).toEqual([]);
});
