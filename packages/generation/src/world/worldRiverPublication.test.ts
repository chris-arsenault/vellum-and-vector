import { expect, it } from "vitest";
import { worldGeographyFixture } from "./worldGeographyFixtures";
import { extractNativeGeography } from "./atlasFeatures";
import { runOperation } from "../processOperation";
import { processOwner } from "../processTraits";
import type { MapProcessContext } from "../process";
import { addReach } from "../water/reachEvolution";
import { publishGenerationProducts } from "../publication";
import { drawnRivers, keptReaches, mappedRiverCells, riversOf } from "../area/riverCourses";
import { releaseHeld } from "../poi/poiReads";
import { establishRiverIdentities, markDrawnReaches } from "../water/riverVisibility";
import { reachAt, retainRiverCourse } from "../water/riverKeeping";
import { nativePosition } from "./atlasWorkspace";
import { retainPublishedRiverNames } from "../area/riverPublish";
import type { Bounds } from "@atlas/domain";
import { createRiverPaths } from "./riverPaths";

function suppliedNetwork(branchFlow: number, bounds?: Bounds) {
  const state = worldGeographyFixture(bounds, 25_000),
    map = state.physical!.map,
    main = Array.from({ length: 13 }, (_, k) => [
      map.mesh.addressCell(k - 6, 0, false),
      map.mesh.addressCell(k - 6, 0, true),
    ]).flat(),
    junction = map.mesh.addressCell(0, 0, false),
    branch = Array.from({ length: 6 }, (_, k) => [
      map.mesh.addressCell(0, k - 6, false),
      map.mesh.addressCell(0, k - 6, true),
    ]).flat();
  expect([...main, ...branch]).not.toContain(-1);
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
  establishRiverIdentities(map);
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
  const owned = [...state.physical.map.rivers.reaches.values()].find((reach) => reach.river)!;
  expect(features.find((feature) => feature.kind === "river")?.attributes.riverId).toBe(
    owned.river
  );
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
  tributary.river = "supplied-tributary";
  tributary.drawn = true;
  releaseHeld(state);
  expect(mappedRiverCells(state).has(tributary.cells[0])).toBe(true);
  tributary.drawn = false;
  delete tributary.river;
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

it("captures final published names without establishing another river", () => {
  const { state, publish } = suppliedNetwork(50),
    map = state.physical.map,
    upper = [...map.rivers.reaches.values()][0];
  upper.dry = true;
  upper.monthly.fill(0);
  markDrawnReaches(map);
  releaseHeld(state);
  publish();
  const dry = Object.values(state.domain.world.features).find(
      (feature) => feature.attributes.dryMember
    )!,
    feature = Object.values(state.domain.world.features).find(
      (feature) => feature.kind === "river" && !feature.attributes.dryMember
    )!,
    before = [...map.rivers.reaches.values()].map(({ id, river, drawn }) => ({ id, river, drawn }));
  feature.name = "Inherited Final River Name";
  dry.name = "Independent Dry Component Name";
  retainPublishedRiverNames(state);
  expect(state.domain.world.features[dry.id].name).toBe(feature.name);
  expect(
    [...map.rivers.reaches.values()].map(({ id, river, drawn }) => ({ id, river, drawn }))
  ).toEqual(before);
  const captured = state.domain.world.drainage![state.domain.scope.areaId].kept!;
  expect(captured.reaches.find((reach) => reach.river === feature.attributes.riverId)?.name).toBe(
    feature.name
  );
});

it("publishes established A-to-C membership after B becomes the stronger tributary", () => {
  const { state, publish } = suppliedNetwork(750, [0, 0, 600_000, 1_000_000]),
    map = state.physical.map,
    [a, b, c] = [...map.rivers.reaches.values()],
    main = a.river!,
    branch = b.river!;
  expect(main).toBe(c.river);
  expect(branch).toBeDefined();
  expect(branch).not.toBe(main);
  a.monthly.fill(500);
  b.monthly.fill(2000);
  markDrawnReaches(map);
  releaseHeld(state);
  expect(drawnRivers(state, keptReaches(state))).toEqual([
    { riverId: main, parts: [[0, 2]] },
    { riverId: branch, parts: [[1]] },
  ]);
  const courses = riversOf(state);
  expect(courses.find((river) => river.id === main)?.cells).toContain(a.cells[0]);
  expect(courses.find((river) => river.id === main)?.cells).not.toContain(b.cells[0]);
  publish();
  expect(a.river).toBe(main);
  expect(c.river).toBe(main);
  expect(b.river).toBe(branch);
  expect(
    Object.values(state.domain.world.features)
      .filter((feature) => feature.kind === "river")
      .map((feature) => feature.attributes.riverId)
      .sort()
  ).toEqual([main, branch].sort());
  state.publications = [
    {
      kind: "geography",
      layer: state.domain.world.layers.rivers,
      featureKinds: ["river"],
      network: true,
    },
  ];
  expect(() => publishGenerationProducts(state, "retained-course-membership")).not.toThrow();
});

it("publishes retained confluences and network cuts when current quantity routes disagree", () => {
  const { state, publish } = suppliedNetwork(750, [0, 0, 600_000, 1_000_000]),
    map = state.physical.map,
    [a, b, c] = [...map.rivers.reaches.values()];
  map.FlowTargets.set(a.cells.at(-1)!, -1);
  map.FlowTargets.set(b.cells.at(-1)!, -1);
  map.FlowTargets.set(c.cells[0], -1);
  releaseHeld(state);
  const records = keptReaches(state),
    paths = createRiverPaths(map);
  expect(records[0].members.at(-1)).toBe(c.cells[0]);
  expect(records[1].members.at(-1)).toBe(c.cells[0]);
  expect(records[0].reach.downstream).toBe(2);
  expect(records[1].reach.downstream).toBe(2);
  expect(paths.incoming!.get(c.cells[0])).toBe(2);
  publish();
  const features = Object.values(state.domain.world.features),
    main = features.find((feature) => feature.attributes.riverId === a.river)!,
    branch = features.find((feature) => feature.attributes.riverId === b.river)!,
    edges = Object.values(state.domain.world.networkReaches!),
    mainEdges = edges.filter((edge) => edge.featureId === main.id),
    branchEdges = edges.filter((edge) => edge.featureId === branch.id);
  expect(mainEdges).toHaveLength(2);
  expect(branchEdges).toHaveLength(1);
  const junction = mainEdges.find((edge) =>
    mainEdges.some((other) => edge.end === other.start)
  )!.end;
  expect(branchEdges[0].end).toBe(junction);
  state.publications = [
    {
      kind: "geography",
      layer: state.domain.world.layers.rivers,
      featureKinds: ["river"],
      network: true,
    },
  ];
  expect(() => publishGenerationProducts(state, "retained-confluence-geometry")).not.toThrow();
});

it("publishes a dry member beside its river's running course under their shared identity", () => {
  const { state, publish } = suppliedNetwork(50),
    map = state.physical.map,
    [upper, , lower] = [...map.rivers.reaches.values()],
    river = lower.river!,
    before = Object.values(state.domain.world.features).find(
      (feature) => feature.attributes.riverId === river
    )!;
  expect(upper.river).toBe(river);
  upper.dry = true;
  upper.monthly.fill(0);
  markDrawnReaches(map);
  releaseHeld(state);
  publish();
  const features = Object.values(state.domain.world.features).filter(
      (feature) => feature.attributes.riverId === river
    ),
    running = features.find((feature) => feature.attributes.regime !== "dry"),
    dry = features.find((feature) => feature.attributes.regime === "dry");
  expect(running?.id).toBe(before.id);
  expect(dry?.id).toBeDefined();
  expect(dry?.id).not.toBe(running?.id);
  expect(dry?.name).toBe(running?.name);
  state.publications = [
    {
      kind: "geography",
      layer: state.domain.world.layers.rivers,
      featureKinds: ["river"],
      network: true,
    },
  ];
  expect(() => publishGenerationProducts(state, "mixed-retained-river")).not.toThrow();
  upper.dry = false;
  upper.monthly.fill(1000);
  markDrawnReaches(map);
  releaseHeld(state);
  publish();
  expect(state.domain.world.features[dry!.id]).toBeUndefined();
  expect(
    Object.values(state.domain.world.networkReaches!).some((reach) => reach.featureId === dry!.id)
  ).toBe(false);
  expect(state.domain.world.features[before.id].attributes.regime).not.toBe("dry");
  expect(() => publishGenerationProducts(state, "returned-retained-river")).not.toThrow();
});

it.each([0, 1])("publishes a newly retained named dry seat stream joining at position %s", (at) => {
  const { state, publish } = suppliedNetwork(50),
    map = state.physical.map,
    mesh = map.mesh,
    receiving = [...map.rivers.reaches.values()].find(
      (reach) =>
        reach.cells.length > at &&
        Array.from({ length: mesh.degree(reach.cells[at]) }, (_, edge) =>
          mesh.neighbor(reach.cells[at], edge)
        ).some((cell) => mesh.membership(cell) === 1 && !reachAt(map, cell))
    )!,
    junction = receiving.cells[at],
    source = Array.from({ length: mesh.degree(junction) }, (_, edge) =>
      mesh.neighbor(junction, edge)
    ).find((cell) => mesh.membership(cell) === 1 && !reachAt(map, cell))!,
    kept = retainRiverCourse(map, [source, junction], "seat-stream", "Alder Brook")!;
  expect(kept.cells).toEqual([source]);
  expect(kept.downstream).toBe(receiving.id);
  // A dry course keeps its junction even when today's unresolved water goes elsewhere.
  map.FlowTargets.set(source, -1);
  releaseHeld(state);
  publish();
  const feature = Object.values(state.domain.world.features).find(
    (feature) => feature.attributes.riverId === "seat-stream"
  );
  expect(feature?.name).toBe("Alder Brook");
  expect(feature?.attributes.regime).toBe("dry");
  expect(feature?.geometry).toEqual({
    type: "LineString",
    coordinates: [source, junction].map((cell) => {
      const point = nativePosition(state.physical, cell);
      return [Math.round(point.x), Math.round(point.y)];
    }),
  });
  expect(
    Object.values(state.domain.world.networkReaches!).some(
      (reach) => reach.featureId === feature!.id
    )
  ).toBe(true);
  state.publications = [
    {
      kind: "geography",
      layer: state.domain.world.layers.rivers,
      featureKinds: ["river"],
      network: true,
    },
  ];
  expect(() => publishGenerationProducts(state, "new-dry-seat-stream")).not.toThrow();
});
