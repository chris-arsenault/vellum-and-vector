import { expect, it } from "vitest";
import type { AtlasFeature } from "@atlas/domain";
import { continuingRivers } from "../area/riverLineage";
import { createTestField } from "../rock/groundTestFixture";
import { createWorldMesh } from "../world/worldMesh";
import { addReach } from "../water/reachEvolution";
import { featureCauses } from "./causes/registry";
import { capturedCourses } from "./courses";
import { nativePosition } from "../world/atlasWorkspace";
import { worldGeographyFixture } from "../world/worldGeographyFixtures";
import type { RegionalState } from "./state";
import "./causes/course";

it("uses owned courses for corridor influence when feature lineage describes another course", () => {
  const map = createTestField(createWorldMesh([0, 0, 1000, 1000], 32, 0)),
    actual = 0,
    ancestor = map.mesh.count - 1,
    cost = new Float64Array(map.mesh.count).fill(1),
    state = {
      physical: { map },
      regional: {
        parentSpan: map.mesh.spacing,
        evidence: { courses: [{ cells: Int32Array.of(ancestor) }] },
      },
    } as unknown as RegionalState;
  const reach = addReach(map.rivers, [actual, map.mesh.neighbor(actual, 0)]),
    former = Math.floor(map.mesh.count / 2);
  reach.former = [{ cells: [former], leftIn: 1 }];
  featureCauses().find((cause) => cause.kind === "river")!.influence!(state, cost);
  expect(cost[actual]).toBeLessThan(cost[ancestor]);
  expect(cost[ancestor]).toBe(1);
  expect(cost[former]).toBeLessThan(1);
});

function capturedFragments() {
  const supplied = worldGeographyFixture([0, 0, 8000, 8000], 1000),
    state = Object.assign(supplied, { regional: { input: { areaId: "area" } } }) as RegionalState,
    mesh = state.physical.map.mesh,
    first = 0,
    last = mesh.count - 1,
    line = (cell: number) => {
      const cells = [cell, mesh.neighbor(cell, 0)];
      return cells.map((i) => {
        const p = nativePosition(state.physical, i);
        return [p.x, p.y];
      });
    },
    ancestor = {
      sourceId: "ancestor",
      geometry: { type: "LineString", coordinates: line(last) },
      discharge: 9999,
      order: 9,
    },
    feature = (id: string, cell: number): AtlasFeature =>
      ({
        id,
        kind: "river",
        geometry: { type: "LineString", coordinates: line(cell) },
        attributes: { riverId: "same-river", discharge: 10, order: 2, capturedCourse: ancestor },
      }) as AtlasFeature,
    features = [feature("first", first), feature("last", last)];
  state.sourceFeatures = { get: (id) => features.find((f) => f.id === id), values: () => features };
  return { state, first, last, features };
}

it("captures every current fragment and its current size despite their shared ancestral course", () => {
  const { state, first, last } = capturedFragments(),
    courses = capturedCourses(state);
  expect(courses).toHaveLength(2);
  expect(courses[0].cells[0]).toBe(first);
  expect(courses[1].cells[0]).toBe(last);
  expect(courses.map(({ discharge, order }) => ({ discharge, order }))).toEqual([
    { discharge: 10, order: 2 },
    { discharge: 10, order: 2 },
  ]);
  state.regional.evidence = { courses } as RegionalState["regional"]["evidence"];
  expect(continuingRivers(state).map(({ head }) => head)).toEqual([first, last]);
});

it("samples multipart captured courses without inventing a segment across their gap", () => {
  const { state, first, last, features } = capturedFragments(),
    expected = capturedCourses(state).flatMap((course) => [...course.cells]),
    lines = features.map((feature) =>
      feature.geometry.type === "LineString" ? feature.geometry.coordinates : []
    );
  features[0].geometry = { type: "MultiLineString", coordinates: lines };
  features.pop();
  const [course] = capturedCourses(state);
  expect([...course.cells]).toContain(first);
  expect([...course.cells]).toContain(last);
  expect([...course.cells]).toEqual(expected);
});
