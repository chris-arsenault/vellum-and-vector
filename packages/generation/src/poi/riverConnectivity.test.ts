import { expect, it } from "vitest";
import { MapScale, point, spatial } from "@atlas/domain";
import { addReach } from "../water/reachEvolution";
import { nativePosition } from "../world/atlasWorkspace";
import { worldGeographyFixture } from "../world/worldGeographyFixtures";
import { flowGradient, gradientInto } from "./ground/groundReads";
import { courseRecord } from "./poiRecords";
import { spring } from "./water/spring";
import { flowTarget, inflows } from "./water/waterReads";

function suppliedCourse() {
  const state = worldGeographyFixture([0, 0, 8000, 8000], 1000),
    map = state.physical.map,
    source = Array.from({ length: map.mesh.count }, (_, cell) => cell).find(
      (cell) =>
        !map.mesh.boundary(cell) &&
        map.mesh.degree(cell) >= 2 &&
        !map.mesh.boundary(map.mesh.neighbor(cell, 0))
    )!,
    target = map.mesh.neighbor(source, 0),
    other = map.mesh.neighbor(source, 1),
    terrain = Array.from({ length: map.mesh.degree(target) }, (_, edge) =>
      map.mesh.neighbor(target, edge)
    ).find((cell) => cell >= 0 && cell !== source && cell !== other)!,
    reach = addReach(map.rivers, [source, target]);
  reach.river = "owned-river";
  reach.drawn = true;
  reach.monthly.fill(20);
  map.Elevation.set(source, MapScale.native(200));
  map.Elevation.set(target, MapScale.native(100));
  map.Elevation.set(other, MapScale.native(300));
  map.FlowTargets.set(source, other);
  map.FlowTargets.set(terrain, target);
  return { state, source, target, other, terrain };
}

it("reads river links and placer gradients from the owned course while retaining terrain inflows", () => {
  const { state, source, target, other, terrain } = suppliedCourse();
  expect(flowTarget(state, source)).toBe(target);
  expect(flowTarget(state, target)).toBe(-1);
  expect(flowTarget(state, other)).toBe(-1);
  expect(flowGradient(state, source)).toBeGreaterThan(0);
  expect(gradientInto(state, target)).toBe(flowGradient(state, source));
  expect([...inflows(state, target)]).toContain(terrain);
  expect([...inflows(state, target)]).not.toContain(source);
});

it("does not call a retained confluence a spring head when terrain routing disagrees", () => {
  const { state, target, terrain } = suppliedCourse(),
    map = state.physical.map;
  map.FractureConductance.set(target, 1000);
  map.Slope.set(target, 0.001);
  map.Slope.set(terrain, 0.1);
  expect(spring.recognition.isA!(state, target)).toBe(false);
});

it("draws a gorge along its retained river even when current drainage points elsewhere", () => {
  const { state, source, target, other } = suppliedCourse(),
    record = courseRecord({ kind: "gorge", layer: "geology", name: "Gorge" })(state, {
      id: "gorge",
      kind: "gorge",
      cells: [source, target],
      anchor: source,
    });
  expect(record).not.toBeNull();
  expect(spatial.distance(record!.geometry, point(nativePosition(state.physical, target)))).toBe(0);
  expect(
    spatial.distance(record!.geometry, point(nativePosition(state.physical, other)))
  ).toBeGreaterThan(0);
});
