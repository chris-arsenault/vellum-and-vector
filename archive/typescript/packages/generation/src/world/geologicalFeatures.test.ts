import { expect, it } from "vitest";
import { createWorldLattice, spatial, type Bounds } from "@atlas/domain";
import { createTestField as createField } from "../rock/groundTestFixture";
import { extractFaults } from "./geologicalFeatures";
import { worldGeographyFixture } from "./worldGeographyFixtures";

/** Explicit fault stations; this fixture runs no geological process. */
function suppliedFault(wrapped: boolean, from: number, to: number) {
  const bounds: Bounds = [0, 0, 4_000_000, 3_000_000],
    state = worldGeographyFixture(bounds, 1_000_000),
    map = createField(createWorldLattice(bounds, 16, 0, { wrapX: wrapped }));
  state.physical.map = map;
  state.domain.world.reference.boundaryMode = wrapped ? "cylinder" : "none";
  map.faults.push({
    id: "fault:0",
    width: 1000,
    coordinates: [from, to].map((x) => [x - map.mesh.origin[0], 0]),
  });
  return state;
}

it("does not promote a short fault because its stations cross the cylindrical chart seam", () => {
  const state = suppliedFault(true, 3_999_000, 1000);
  extractFaults(state);
  expect(Object.values(state.domain.world.features)).toHaveLength(0);
});

it("publishes both chart pieces of a significant seam-crossing fault under one cause", () => {
  const state = suppliedFault(true, 3_800_000, 200_000);
  extractFaults(state);
  const features = Object.values(state.domain.world.features);
  expect(features).toHaveLength(1);
  expect(features[0].attributes.causeId).toBe("fault:0");
  expect(features[0].geometry.type).toBe("MultiLineString");
  expect(spatial.length(features[0].geometry)).toBeCloseTo(400_000);
  expect(spatial.covers(state.domain.scope.footprint, features[0].geometry)).toBe(true);
});

it("retains the planar distance when the map does not wrap", () => {
  const state = suppliedFault(false, 3_999_000, 1000);
  extractFaults(state);
  const features = Object.values(state.domain.world.features);
  expect(features).toHaveLength(1);
  expect(features[0].geometry.type).toBe("LineString");
  expect(spatial.length(features[0].geometry)).toBeCloseTo(3_998_000);
});
