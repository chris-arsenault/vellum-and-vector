import { expect, it } from "vitest";
import { contributingArea, targetOrder, waterGathered } from "./flowGraph";
import { passingWater } from "../water/waterQuantity";
import { createField } from "./field";
import { createWorldMesh } from "./worldMesh";

/** A small field whose flow targets are set by hand; the mesh only supplies cell areas. */
function field() {
  const map = createField(createWorldMesh([0, 0, 4000, 4000], 16, 0));
  map.FlowTargets.fill(-1);
  return map;
}

it("orders every cell before its target and accumulates area down the chain", () => {
  const map = field(),
    n = map.mesh.count;
  // Two chains into one outlet: 0→1→2→3 and 4→5→3; everything else drains nowhere.
  for (const [from, to] of [
    [0, 1],
    [1, 2],
    [2, 3],
    [4, 5],
    [5, 3],
  ])
    map.FlowTargets.set(from, to);
  const order = targetOrder(map, map.FlowTargets),
    position = new Int32Array(n);
  for (let k = 0; k < n; k++) position[order.get(k)] = k;
  for (let i = 0; i < n; i++) {
    const target = map.FlowTargets.get(i);
    if (target >= 0) expect(position[i]).toBeLessThan(position[target]);
  }
  expect(new Set(Array.from({ length: n }, (_, k) => order.get(k))).size).toBe(n);
  const area = contributingArea(map, map.FlowTargets),
    own = (i: number) => map.mesh.area(i);
  expect(area.get(3)).toBeCloseTo(
    [0, 1, 2, 3, 4, 5].reduce((s, i) => s + own(i), 0),
    6
  );
  expect(area.get(1)).toBeCloseTo(own(0) + own(1), 6);
  expect(area.get(4)).toBeCloseTo(own(4), 6);
  // Nothing is lost or counted twice: the outlets together drain the whole field.
  let outlets = 0;
  for (let i = 0; i < n; i++) if (map.FlowTargets.get(i) < 0) outlets += area.get(i);
  let total = 0;
  for (let i = 0; i < n; i++) total += own(i);
  expect(outlets).toBeCloseTo(total, 6);
});

it("rejects a routing that cycles", () => {
  const map = field();
  map.FlowTargets.set(0, 1);
  map.FlowTargets.set(1, 0);
  expect(() => targetOrder(map, map.FlowTargets)).toThrow(/cycle/);
});

it("applies an intake once before sending the remaining water to the next cell", () => {
  const map = field();
  map.FlowTargets.set(0, 1);
  map.FlowTargets.set(1, 2);
  const received = [10, 5, 7],
    water = waterGathered(
      map,
      map.FlowTargets,
      { get: (cell) => (received[cell] ?? 0) / map.mesh.area(cell) },
      (cell, amount) => (cell === 1 ? passingWater(amount, 4, 0.5) : amount)
    );
  expect(water.get(0)).toBeCloseTo(10);
  expect(water.get(1)).toBeCloseTo(5.5);
  expect(water.get(2)).toBeCloseTo(12.5);
});
