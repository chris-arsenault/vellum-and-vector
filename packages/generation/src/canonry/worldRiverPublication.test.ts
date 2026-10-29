import { expect, it } from "vitest";
import { worldGeographyFixture } from "./worldGeographyFixtures";
import { extractNativeGeography } from "./atlasFeatures";
import type { MapProcessContext } from "../process";

function suppliedNetwork(branchFlow: number) {
  const state = worldGeographyFixture(undefined, 25_000),
    map = state.physical!.map,
    cells = Array.from({ length: map.mesh.count }, (_, i) => i),
    row = Math.min(...cells.map((i) => Math.abs(map.mesh.y(i)))),
    main = cells.filter((i) => map.mesh.y(i) === row).sort((a, b) => map.mesh.x(a) - map.mesh.x(b)),
    junction = main[Math.floor(main.length * 0.75)],
    branch = cells
      .filter((i) => map.mesh.x(i) === map.mesh.x(junction) && map.mesh.y(i) < row)
      .sort((a, b) => map.mesh.y(a) - map.mesh.y(b));
  for (const [path, flow, end] of [
    [main, 1_000, -1],
    [branch, branchFlow, junction],
  ] as const)
    path.forEach((cell, n) => {
      map.FlowTargets.set(cell, path[n + 1] ?? end);
      map.RiverOrders.set(cell, 2);
      map.FlowAccumulation.set(cell, flow);
      map.CatchmentArea.set(cell, 50e9);
      map.DrainageBasinIds.set(cell, 1);
      map.RiverWidth.set(cell, 50);
      map.RiverDepth.set(cell, 3);
    });
  const context: MapProcessContext = {
    scope: state.domain.scope,
    invocation: [],
    parameters: {},
    epochs: [],
    epochIndices: [],
    causes: [],
    recordCause() {},
    progress() {},
    random: () => 0.5,
    cancelled: () => false,
  };
  extractNativeGeography(state, context, {
    oceans: false,
    impacts: false,
    volcanism: false,
    fractures: false,
    lakes: false,
    landforms: false,
    magic: false,
    ecology: false,
    rivers: true,
    landmarks: false,
  });
  return state;
}
it("publishes one main river identity while retaining omitted tributary drainage", () => {
  const state = suppliedNetwork(50),
    features = Object.values(state.domain.world.features);
  expect(features.filter((f) => f.kind === "river")).toHaveLength(1);
  const drainage = state.domain.world.drainage!.area.reaches;
  expect(drainage.length).toBeGreaterThan(1);
  expect(drainage.some((r) => !r.featureIds.length)).toBe(true);
  expect(new Set(drainage.flatMap((r) => r.featureIds)).size).toBe(1);
  const network = Object.values(state.domain.world.networkReaches!);
  expect(network).toHaveLength(2);
  expect(network[0].end).toBe(network[1].start);
});
