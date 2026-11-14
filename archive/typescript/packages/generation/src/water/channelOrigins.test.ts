import { expect, it } from "vitest";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { workingArray } from "../world/physicalNumerics";
import { physicalDistance } from "../world/physicalMetric";
import { channelOrigins } from "./channelOrigins";

it("gathers unresolved channel shares into a resolvable course, with none supplied by dry ground", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    order = workingArray(map, "int32", "test:order"),
    length = workingArray(map, "float64", "test:channel-length"),
    step = physicalDistance(map.mesh, 2, 4);
  map.FlowTargets.fill(-1);
  map.FlowTargets.set(0, 2);
  map.FlowTargets.set(1, 2);
  map.FlowTargets.set(2, 4);
  for (let cell = 0; cell < map.mesh.count; cell++) order.set(cell, cell);
  length.set(0, step * 0.6);
  length.set(1, step * 0.6);
  expect(channelOrigins(map, order, length)[2]).toBe(1);
  expect(channelOrigins(map, order, length)[3]).toBe(0);
  length.fill(0);
  expect(channelOrigins(map, order, length).some(Boolean)).toBe(false);
});
