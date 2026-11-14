import { expect, it } from "vitest";
import { point, type AtlasFeature } from "@atlas/domain";
import { continuingRivers } from "../area/riverLineage";
import { addReach } from "../water/reachEvolution";
import { riverStorage } from "../water/riverStorage";
import { Contributions } from "../coupling/fieldContributions";
import { featureCauses } from "./causes/registry";
import { capturedCourses } from "./courses";
import { nativePosition } from "../world/atlasWorkspace";
import { worldGeographyFixture } from "../world/worldGeographyFixtures";
import type { RegionalState, RegionalWork } from "./state";
import "./causes/course";

function suppliedRegion(bounds: [number, number, number, number], size: number) {
  const supplied = worldGeographyFixture(bounds, size),
    map = supplied.physical.map,
    regional: RegionalWork = {
      input: { areaId: "area", quality: "draft", seed: 73, domains: ["physical"] },
      parentSpan: map.mesh.spacing,
      inheritedHeight: map.coverage.copyBand(map.Elevation),
      natural: {},
      contributions: new Contributions(map.mesh.count),
      round: 0,
      evidence: { courses: [], lakes: [], seats: [], entries: [], landmarks: [] },
    };
  return Object.assign(supplied, { regional });
}

function sourceFeature(
  state: RegionalState,
  id: string,
  geometry: AtlasFeature["geometry"],
  attributes: AtlasFeature["attributes"]
): AtlasFeature {
  return {
    id,
    name: id,
    areaId: state.regional.input.areaId,
    layerId: "rivers",
    kind: "river",
    geometry,
    attributes,
    relations: [],
    detail: {},
    causes: [],
    state: "generated",
    protected: false,
    actor: "generator",
    generationId: null,
  };
}

it("uses owned courses for corridor influence when feature lineage describes another course", () => {
  const state = suppliedRegion([0, 0, 1000, 1000], 1000 / Math.sqrt(32)),
    map = state.physical.map,
    actual = 0,
    ancestor = map.mesh.count - 1,
    cost = new Float64Array(map.mesh.count).fill(1);
  state.regional.evidence!.courses.push({
    feature: sourceFeature(state, "ancestor", point(nativePosition(state.physical, ancestor)), {}),
    cells: Int32Array.of(ancestor),
    discharge: 10,
    order: 1,
  });
  const reach = addReach(riverStorage(map), [actual, map.mesh.neighbor(actual, 0)]),
    former = Math.floor(map.mesh.count / 2);
  reach.former = [{ cells: [former], leftIn: 1 }];
  featureCauses().find((cause) => cause.kind === "river")!.influence!(state, cost);
  expect(cost[actual]).toBeLessThan(cost[ancestor]);
  expect(cost[ancestor]).toBe(1);
  expect(cost[former]).toBeLessThan(1);
});

function capturedFragments() {
  const state = suppliedRegion([0, 0, 8000, 8000], 1000),
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
      sourceFeature(
        state,
        id,
        { type: "LineString", coordinates: line(cell) },
        { riverId: "same-river", discharge: 10, order: 2, capturedCourse: ancestor }
      ),
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
  state.regional.evidence!.courses = courses;
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
