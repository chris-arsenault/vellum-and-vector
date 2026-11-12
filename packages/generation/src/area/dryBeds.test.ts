import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { dryBedCourses } from "./dryBeds";
import { courseRegime } from "./riverPublish";

/** A field of dry land with a chain of neighbouring cells draining one into the next. */
function chained(length: number) {
  const map = createTestField(createWorldMesh([0, 0, 10_000, 10_000], 16, 0)),
    chain = [0];
  map.WaterKindCodes.fill(0);
  map.FlowTargets.fill(-1);
  while (chain.length < length) {
    const at = chain[chain.length - 1];
    let next = -1;
    for (let edge = 0; edge < map.mesh.degree(at) && next < 0; edge++) {
      const j = map.mesh.neighbor(at, edge);
      if (j >= 0 && !chain.includes(j)) next = j;
    }
    map.FlowTargets.set(at, next);
    chain.push(next);
  }
  return { map, chain };
}

it("follows an old bed from its head down to the river it ran into", () => {
  const { map, chain } = chained(5);
  // The upper three cells carried a river once; the lower two still do.
  for (const cell of chain) map.RiverMemory.set(cell, 2);
  map.RiverOrders.set(chain[3], 2);
  map.RiverOrders.set(chain[4], 2);
  expect(dryBedCourses(map)).toEqual([chain.slice(0, 4)]);
});

it("finds no old bed where every remembered river still runs, or none ever ran", () => {
  const { map, chain } = chained(4);
  expect(dryBedCourses(map)).toEqual([]);
  for (const cell of chain) {
    map.RiverMemory.set(cell, 1);
    map.RiverOrders.set(cell, 1);
  }
  expect(dryBedCourses(map)).toEqual([]);
});

it("names a river by what the greater part of its course does through the year", () => {
  expect(courseRegime([12, 12, 12, 7])).toBe("perennial");
  expect(courseRegime([0, 3, 5, 12])).toBe("seasonal");
  expect(courseRegime([0, 0, 0, 4])).toBe("dry");
  expect(courseRegime()).toBe("dry");
});
