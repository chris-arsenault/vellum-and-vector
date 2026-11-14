import { expect, it } from "vitest";
import { residentBand } from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createTestField } from "../rock/groundTestFixture";
import { addReach } from "../water/reachEvolution";
import { createWorldMesh } from "./worldMesh";
import { units } from "./math";
import { riverDrop } from "./landforms";
import { floodplainSources } from "./floodplains";
import { dischargeOf, sizeAtCell } from "../poi/water/waterfallShape";
import { atlasPhysicalProfile } from "./atlasProfile";

function suppliedRiver() {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 16, 0)),
    head = 0,
    tail = map.mesh.neighbor(head, 0),
    reach = addReach(map.rivers, [head, tail]);
  map.FlowTargets.set(head, tail);
  reach.order = 2;
  reach.monthly.fill(20, 0, 12);
  reach.bed[0] = units(100);
  reach.bed[1] = units(80);
  return { map, head, tail, reach };
}

it("reads a waterfall's discharge from its river profile when the cell quantity disagrees", () => {
  const { map, head } = suppliedRiver();
  map.FlowAccumulation.set(head, 900);
  const state = landscape();
  state.physical = {
    map,
    profile: atlasPhysicalProfile({}, {}, map.scale),
    grid: state.surface.coverage,
    samples: residentBand("int32", new Int32Array(state.surface.active.length)),
    fixed: [],
    inherited: false,
  };
  expect(dischargeOf(state, { id: "falls", kind: "waterfall", anchor: head, cells: [head] })).toBe(
    20
  );
  map.FlowAccumulation.set(head, 0);
  expect(sizeAtCell(state, head).width).toBeGreaterThan(0);
});

it("reads the river's drop from its bed rather than the averaged plateau height", () => {
  const { map, head, tail } = suppliedRiver();
  map.Elevation.set(head, units(200));
  map.Elevation.set(tail, units(200));
  map.FlowTargets.set(head, -1);
  expect(riverDrop(map, head)).toBe(20);
  map.WaterKindCodes.set(tail, 2);
  map.WaterSurfaceElevations.set(tail, units(95));
  map.Elevation.set(tail, units(70));
  expect(riverDrop(map, head)).toBe(5);
});

it("seeds floodplains from the wet part of a losing river, excluding its dry tail", () => {
  const { map, head, tail } = suppliedRiver();
  map.RiverChannelStrength.set(tail, 900);
  expect([...floodplainSources(map, 2)]).toEqual([head]);
  map.WaterKindCodes.set(head, 2);
  expect([...floodplainSources(map, 2)]).toEqual([]);
});
