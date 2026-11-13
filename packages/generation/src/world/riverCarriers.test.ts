import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { addReach } from "../water/reachEvolution";
import { createWorldMesh } from "./worldMesh";
import { placerTarget } from "./magicStocks";
import { sedimentTarget } from "./fluvial";
import { deltaMouth } from "./deltas";
import { targetOrder } from "./flowGraph";
import { releaseWorking, workingValues } from "./physicalNumerics";

function suppliedCourse() {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    neighbors = (cell: number) =>
      Array.from({ length: map.mesh.degree(cell) }, (_, edge) =>
        map.mesh.neighbor(cell, edge)
      ).filter((next) => next >= 0),
    head = Array.from({ length: map.mesh.count }, (_, cell) => cell).find(
      (cell) => neighbors(cell).length >= 2 && neighbors(neighbors(cell)[0]).length >= 2
    )!,
    [tail, other] = neighbors(head),
    reach = addReach(map.rivers, [head, tail]);
  map.FlowTargets.fill(-1);
  map.FlowTargets.set(head, other);
  reach.drawn = true;
  reach.monthly.fill(20);
  return { map, head, tail, other, reach };
}

it("carries placer stock along its actual river rather than a newly preferred cell route", () => {
  const { map, head, tail, other, reach } = suppliedCourse();
  expect(placerTarget(map, head)).toBe(tail);
  map.FlowTargets.set(tail, other);
  expect(placerTarget(map, tail)).toBe(-1);
  reach.dry = true;
  expect(placerTarget(map, head)).toBe(other);
});

it("uses retained sediment carriers even below drawing significance, retaining other cell routes", () => {
  const { map, head, tail, other, reach } = suppliedCourse();
  reach.drawn = false;
  expect(sedimentTarget(map, head)).toBe(tail);
  reach.dry = true;
  expect(sedimentTarget(map, head)).toBe(other);
  reach.dry = false;
  map.WaterKindCodes.set(head, 2);
  expect(sedimentTarget(map, head)).toBe(other);
  map.FlowTargets.set(other, head);
  expect(sedimentTarget(map, other)).toBe(head);
});

it("orders material delivery by the same selected graph that receives the cargo", () => {
  const { map, head, tail } = suppliedCourse();
  map.FlowTargets.set(tail, head);
  const targets = workingValues(map, "int32", "test:sediment-targets", (cell) =>
      sedimentTarget(map, cell)
    ),
    order = targetOrder(map, targets),
    cells = Array.from({ length: order.length }, (_, at) => order.get(at));
  expect(cells.indexOf(head)).toBeLessThan(cells.indexOf(tail));
  expect(targets.get(tail)).toBe(-1);
  releaseWorking(map, targets, order);
});

it("locates a delta at the retained mouth rather than an ocean-directed alternative upstream", () => {
  const { map, head, tail, other } = suppliedCourse();
  map.WaterKindCodes.set(other, 1);
  expect(deltaMouth(map, head)).toBe(-1);
  const sea = Array.from({ length: map.mesh.degree(tail) }, (_, edge) =>
    map.mesh.neighbor(tail, edge)
  ).find((cell) => cell >= 0 && cell !== head)!;
  map.WaterKindCodes.set(sea, 1);
  map.FlowTargets.set(tail, sea);
  expect(deltaMouth(map, tail)).toBe(sea);
});
