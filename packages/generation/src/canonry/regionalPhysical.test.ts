import { expect, it } from "vitest";
import {
  createGrid,
  fieldInterpolator,
  gridPosition,
  putChannel,
  rectangle,
  residentBand,
} from "@atlas/domain";
import { landscape } from "../mapFixtures";
import { createAdaptiveWorldMesh } from "./adaptiveMesh";
import { createField } from "./field";
import { atlasPhysicalProfile } from "./atlasProfile";
import { units } from "./math";
import { sourceToOutletOrder } from "./flowGraph";
import { constructRegionalRelief, constructRegionalWater } from "./regionalPhysical";
import { depthRateToDischarge } from "./dimensions";
import type { Polygon } from "geojson";
import type { World } from "@atlas/domain";

function parentFixture() {
  const state = landscape(),
    world = state.domain.world,
    footprint = rectangle([0, 0, 40_000, 20_000]),
    parent = createGrid("parent", { ...state.domain.scope, footprint }, 5, 3);
  putChannel(
    parent,
    "elevation",
    "metre",
    residentBand(
      "float64",
      Float64Array.from(parent.active, (_, i) => 100 + gridPosition(parent, i).x / 100)
    )
  );
  state.domain.numerical.parent = parent;
  world.areas.area.footprint = footprint;
  world.reference.domain = footprint;
  world.fields = [
    {
      id: "parent",
      areaId: "area",
      layerId: "physical",
      algorithm: "fixture",
      source: { kind: "operation", id: "fixture" },
      samples: parent.active.length,
      channels: ["elevation"],
    },
  ];
  return { state, parent };
}
function regionalArea(world: World, inflow: number) {
  const shape = {
    type: "Polygon" as const,
    coordinates: [
      [
        [2000, 2000],
        [38_000, 2000],
        [38_000, 18_000],
        [20_000, 15_000],
        [2000, 18_000],
        [2000, 2000],
      ],
    ],
  };
  const area = {
    ...world.areas.area,
    id: "child",
    parentId: "area",
    profile: "region" as const,
    footprint: shape,
    boundary: {
      version: 1,
      parentId: "area",
      parentVersion: 1,
      epochs: [],
      samples: [],
      crossings: [
        {
          featureId: "river",
          point: { x: 38_000, y: 10_000, z: 480 },
          kind: "river",
          direction: "incoming",
          elevation: 480,
          flow: inflow,
        },
      ],
    },
  };
  return area;
}
function fixture(inflow = 100) {
  const { state, parent } = parentFixture(),
    world = state.domain.world,
    area = regionalArea(world, inflow),
    shape = area.footprint;
  world.areas.child = area;
  world.drainage = inheritedDrainage();
  state.domain.scope = {
    ...state.domain.scope,
    areaId: "child",
    footprint: shape,
    resolution: 1000,
  };
  state.surface = createGrid("child", state.domain.scope, 17, 9);
  const map = createField(
      createAdaptiveWorldMesh(
        [0, 0, 40_000, 20_000],
        { maximumSize: 2000, minimumSize: 2000, refine: () => false },
        0,
        shape
      )
    ),
    elevation = fieldInterpolator(parent, "elevation");
  for (let i = 0; i < map.mesh.count; i++) {
    const height = units(
      elevation({
        x: map.mesh.origin[0] + map.mesh.x(i),
        y: map.mesh.origin[1] + map.mesh.y(i),
        z: 0,
      })
    );
    map.Elevation.set(i, height);
    map.BedrockElevation.set(i, height);
    map.CrustSupportElevation.set(i, height);
  }
  map.RockResistance.fill(1000);
  map.Runoff.fill(500);
  map.SeaLevelInitialized = map.CrustSupportInitialized = map.OpenBoundary = true;
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    fixed: [],
    inherited: true,
    samples: residentBand("int32", new Int32Array(0)),
    grid: state.surface.coverage,
    sampling: { maximumSize: 2000, minimumSize: 2000, featureSamples: 2 },
  };
  return { state, parent, map };
}
function inheritedDrainage(): NonNullable<World["drainage"]> {
  return {
    area: {
      areaId: "area",
      spaceId: "surface",
      reaches: [
        {
          downstream: null,
          waterBody: null,
          order: 2,
          basin: 1,
          coordinates: [
            [40_000, 10_000],
            [0, 10_000],
          ],
          discharges: [100, 100],
          catchmentAreas: [1e8, 1e8],
          featureIds: [],
        },
      ],
    },
  };
}
it("constructs deterministic finer relief inside an irregular region without advancing geological history", () => {
  const a = fixture(),
    b = fixture(),
    before = Array.from(a.map.Elevation),
    parent = Array.from(a.parent.channels.elevation);
  constructRegionalRelief(a.state, 123);
  constructRegionalRelief(b.state, 123);
  expect(Array.from(a.map.Elevation)).toEqual(Array.from(b.map.Elevation));
  expect(Array.from(a.map.Elevation).some((height, i) => height !== before[i])).toBe(true);
  expect(Array.from(a.parent.channels.elevation)).toEqual(parent);
  expect(a.map.CompletedEpochCount).toBe(0);
  expect(a.map.events).toEqual([]);
  expect(Array.from(a.map.CumulativeFluvialErosion).every((amount) => amount === 0)).toBe(true);
});
it("routes supplied upstream water plus local runoff through connected tributaries without inventing water", () => {
  const wet = fixture(100),
    dry = fixture(0);
  for (const f of [wet, dry]) {
    constructRegionalRelief(f.state, 123);
    constructRegionalWater(f.state, 123);
  }
  const exported = (f: typeof wet) => {
    let sum = 0;
    for (let i = 0; i < f.map.mesh.count; i++)
      if (f.map.FlowTargets.get(i) < 0) sum += f.map.FlowAccumulation.get(i);
    return sum;
  };
  let supplied = 0;
  for (let i = 0; i < wet.map.mesh.count; i++)
    supplied += depthRateToDischarge(500, wet.map.mesh.area(i));
  expect(exported(wet)).toBeCloseTo(supplied + 100, 6);
  expect(exported(wet) - exported(dry)).toBeCloseTo(100, 6);
  expect(sourceToOutletOrder(wet.map)).toHaveLength(wet.map.mesh.count);
  expect(Array.from(wet.map.RiverOrders).some((order) => order > 0)).toBe(true);
  expect(wet.state.history).toEqual([]);
});
it("keeps both sides of a seam-spanning region joined by short physical edges", () => {
  const footprint = {
    type: "MultiPolygon" as const,
    coordinates: [
      (rectangle([0, 2000, 4000, 18_000]) as Polygon).coordinates,
      (rectangle([36_000, 2000, 40_000, 18_000]) as Polygon).coordinates,
    ],
  };
  const map = createField(
    createAdaptiveWorldMesh(
      [0, 0, 40_000, 20_000],
      { maximumSize: 2000, minimumSize: 2000, refine: () => false },
      0,
      footprint,
      true
    )
  );
  let crossings = 0;
  for (let i = 0; i < map.mesh.count; i++)
    for (let edge = 0; edge < map.mesh.degree(i); edge++) {
      const j = map.mesh.neighbor(i, edge);
      if (Math.abs(map.mesh.x(i) - map.mesh.x(j)) < 30_000) continue;
      crossings++;
      expect(map.mesh.edgeLength(i, edge)).toBeLessThan(3000);
      expect(
        Array.from({ length: map.mesh.degree(j) }, (_, e) => map.mesh.neighbor(j, e))
      ).toContain(i);
    }
  expect(crossings).toBeGreaterThan(0);
  expect(map.mesh.periodic!.width).toBe(40_000);
});
it("realizes an inherited mountain signature without re-emplacing its event", () => {
  const { state, map } = fixture();
  state.domain.world.landmarks = [
    {
      id: "mountain",
      name: "Old summit",
      kind: "resistant-mountain",
      geometry: { type: "Point", coordinates: [20_000, 10_000] },
      parameters: { summit: 2000, prominence: 1000, baseRadius: 8 },
      emplacedAtEpoch: 0,
    },
  ];
  const original = structuredClone(state.domain.world.landmarks);
  constructRegionalRelief(state, 123);
  constructRegionalWater(state, 123);
  const record = state.physical!.landmarks!.get("mountain")!;
  expect(record.measured.summit).toBeGreaterThanOrEqual(1999.99);
  expect(state.domain.world.landmarks).toEqual(original);
  expect(map.events).toEqual([]);
  expect(map.CompletedEpochCount).toBe(0);
});
