import { expect, it } from "vitest";
import { worldGeographyFixture } from "./worldGeographyFixtures";
import { extractNativeGeography } from "./atlasFeatures";
import { runOperation } from "../processOperation";
import { processOwner } from "../processTraits";
import type { MapProcessContext } from "../process";
import { addReach } from "../water/reachEvolution";
import { publishGenerationProducts } from "../publication";
import { mappedRiverCells } from "../area/riverCourses";
import { releaseHeld } from "../poi/poiReads";
import { markDrawnReaches } from "../water/riverVisibility";

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
  // The map keeps its rivers as reaches; publishing reads those.
  const join = main.indexOf(junction);
  [main.slice(0, join), branch, main.slice(join)].forEach((cells, n) => {
    const reach = addReach(map.rivers, cells);
    reach.order = n < 2 ? 1 : 2;
    reach.downstream = n < 2 ? 3 : null;
    reach.drawn = true;
  });
  for (const reach of map.rivers.reaches.values()) {
    reach.months = 12;
    reach.width.fill(50);
    reach.depth.fill(3);
    reach.catchment.fill(50e9);
    reach.bed = Float64Array.from(reach.cells, (cell) => map.Elevation.get(cell));
    reach.cells.forEach((cell, at) =>
      reach.monthly.fill(map.FlowAccumulation.get(cell), at * 12, (at + 1) * 12)
    );
  }
  markDrawnReaches(map);
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
  const publish = () =>
    runOperation(processOwner(state), extractNativeGeography, {
      state,
      context,
      deliveries: {
        oceans: false,
        impacts: false,
        volcanism: false,
        fractures: false,
        lakes: false,
        landforms: false,
        ecology: false,
        rivers: true,
        landmarks: false,
      },
    });
  publish();
  return { state, publish, main };
}
it("publishes one main river identity while retaining omitted tributary drainage", () => {
  const { state, publish, main } = suppliedNetwork(50),
    features = Object.values(state.domain.world.features);
  expect(features.filter((f) => f.kind === "river")).toHaveLength(1);
  const drainage = state.domain.world.drainage!.area.reaches;
  expect(drainage.length).toBeGreaterThan(1);
  expect(drainage.some((r) => !r.featureIds.length)).toBe(true);
  expect(new Set(drainage.flatMap((r) => r.featureIds)).size).toBe(1);
  const network = Object.values(state.domain.world.networkReaches!);
  // The omitted tributary remains in drainage context; it creates no drawn junction.
  expect(network).toHaveLength(1);
  const tributary = [...state.physical!.map.rivers.reaches.values()].find(
    (reach) => reach.monthly[0] === 50
  )!;
  tributary.drawn = true;
  releaseHeld(state);
  expect(mappedRiverCells(state).has(tributary.cells[0])).toBe(true);
  tributary.drawn = false;
  releaseHeld(state);
  const before = features.find((feature) => feature.kind === "river")!;
  const map = state.physical!.map;
  for (const reach of map.rivers.reaches.values()) {
    reach.dry = true;
    if (reach.record) reach.former.push({ cells: [...main].reverse(), leftIn: 1 });
  }
  publish();
  const dried = state.domain.world.features[before.id];
  expect(dried.name).toBe(before.name);
  expect(dried.attributes.regime).toBe("dry");
  expect(dried.attributes.riverId).toBe(before.attributes.riverId);
  const former = Object.values(state.domain.world.features).find(
    (feature) => feature.kind === "river" && feature.attributes.former
  );
  expect(former?.name).toBe(before.name);
  expect(former?.attributes.regime).toBe("dry");
  state.publications = [
    {
      kind: "geography",
      layer: state.domain.world.layers.rivers,
      featureKinds: ["river"],
      network: true,
    },
  ];
  expect(() => publishGenerationProducts(state, "named-dry-river")).not.toThrow();
});
