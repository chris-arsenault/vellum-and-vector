import { expect, it } from "vitest";
import { fieldInterpolator, gridSchema } from "@atlas/domain";
import { macroFixture } from "./macroFixtures";
import { nearestTriangle } from "./mesh";
import { composePass, composeRanges } from "./macroRelief";
import { bakeFinishedTerrain, finishedElevation } from "./macroTerrain";
import { projectNative } from "./atlasProjection";
import { reconstructRegion } from "./macroRegions";
import { composeBiologicalRegions } from "./macroCover";
import { beginFinishing } from "./macroTerrain";
import { crossingPath } from "./macroRelief";
import { composeRiverNetwork } from "./macroRivers";
import { validateLandscape } from "./surface";
import { publishMacroFeatures } from "./macroPublication";
import { addTerrainProfile } from "./macroTerrain";
import { correctRiverCrossings } from "./macroRiverCrossings";
import { crossingReaches } from "./macroNetwork";
import { composeRiverStems } from "./macroRiverStems";

it("repairs crossing rivers without retracting an unrelated composed reach", () => {
  const work = macroFixture().physical!,
    mesh = work.map.mesh;
  mesh.x.set([0, 10, 0, 10, 0, 10]);
  mesh.y.set([0, 0, 10, 10, 30, 30]);
  const curves = [
      {
        points: [
          [0, 0],
          [5, 9],
          [10, 0],
        ] as [number, number][],
        positions: [0, 0.5, 1],
      },
      {
        points: [
          [0, 10],
          [5, 1],
          [10, 10],
        ] as [number, number][],
        positions: [0, 0.5, 1],
      },
      {
        points: [
          [0, 30],
          [5, 35],
          [10, 30],
        ] as [number, number][],
        positions: [0, 0.5, 1],
      },
    ],
    untouched = structuredClone(curves[2]);
  expect(crossingReaches(curves, 100).size).toBe(2);
  correctRiverCrossings(
    work,
    [
      [0, 1],
      [2, 3],
      [4, 5],
    ],
    curves
  );
  expect(crossingReaches(curves, 100).size).toBe(0);
  expect(curves[2]).toEqual(untouched);
});

it("retains missing route corners when sampled chords cross another river", () => {
  const work = macroFixture().physical!,
    mesh = work.map.mesh;
  mesh.x.set([0, 10, 10, 5, 5]);
  mesh.y.set([0, 0, 10, 2, 8]);
  const curves = [
    {
      points: [
        [0, 0],
        [10, 10],
      ] as [number, number][],
      positions: [0, 2],
    },
    {
      points: [
        [5, 2],
        [5, 8],
      ] as [number, number][],
      positions: [0, 1],
    },
  ];
  correctRiverCrossings(
    work,
    [
      [0, 1, 2],
      [3, 4],
    ],
    curves
  );
  expect(crossingReaches(curves, 100).size).toBe(0);
  expect(curves[0].points.length).toBeGreaterThan(2);
});

it("composes the dominant river through a confluence before attaching its tributary", () => {
  const work = macroFixture().physical!,
    map = work.map,
    mesh = map.mesh,
    cells = [
      [-80_000, 0],
      [-40_000, 20_000],
      [0, 0],
      [40_000, 20_000],
      [80_000, 0],
      [0, -60_000],
    ].map(([x, y]) => nearestTriangle(mesh, x, y)),
    paths = {
      x: Float64Array.from(mesh.x),
      y: Float64Array.from(mesh.y),
      upstream: new Int32Array(mesh.count).fill(-1),
    };
  map.FlowTargets.fill(-1);
  map.DrainageBasinIds.fill(1);
  for (let n = 0; n < 5; n++) {
    const i = cells[n];
    map.RiverOrders[i] = 3;
    map.RiverWidth[i] = 2000;
    map.FlowAccumulation[i] = (n + 1) * 100;
    if (n > 0) paths.upstream[i] = cells[n - 1];
    if (n < 4) map.FlowTargets[i] = cells[n + 1];
  }
  map.RiverOrders[cells[5]] = 1;
  map.FlowAccumulation[cells[5]] = 50;
  map.FlowTargets[cells[5]] = cells[2];
  const original = paths.y[cells[2]];
  composeRiverStems(work, paths);
  expect(paths.y[cells[2]] - original).toBeGreaterThan(1000);
  expect(map.FlowTargets[cells[5]]).toBe(cells[2]);
  expect(paths.x[cells[0]]).toBe(mesh.x[cells[0]]);
  expect(paths.x[cells[4]]).toBe(mesh.x[cells[4]]);
});

it("cuts a complete valley-to-valley pass and exposes the same subcell floor through published reads", () => {
  const state = macroFixture(),
    work = state.physical!,
    mesh = work.map.mesh,
    center = nearestTriangle(mesh, 0, 0),
    a = nearestTriangle(mesh, -45_000, 0),
    b = nearestTriangle(mesh, 45_000, 0),
    before = finishedElevation(work)(0, 0);
  composePass(work, center, a, b);
  const pass = work.finishing!.passes[0];
  expect(pass.cells[0]).toBe(a);
  expect(pass.cells.at(-1)).toBe(b);
  expect(pass.cells).toContain(center);
  expect(pass.profile.points).toContainEqual([mesh.x[center], mesh.y[center]]);
  bakeFinishedTerrain(work);
  validateLandscape(work.map);
  expect(finishedElevation(work)(0, 0)).toBeLessThan(before);
  projectNative(state);
  const {overlays, ...coarse} = state.surface;
  expect(gridSchema.safeParse(structuredClone(coarse)).success).toBe(true);
  expect(overlays!.every((part) => gridSchema.safeParse(part.grid).success)).toBe(true);
  const height = fieldInterpolator(state.surface, "elevation"),
    rock = fieldInterpolator(state.surface, "bedrock");
  for (const [x, y] of pass.profile.points) {
    expect(height({ x, y, z: 0 })).toBeCloseTo(finishedElevation(work)(x, y) / 1024, 7);
    expect(rock({ x, y, z: 0 })).toBeCloseTo(height({ x, y, z: 0 }), 7);
  }
});

it("moves drainage head with fitted dry terrain instead of creating phantom marshes", () => {
  const work = macroFixture().physical!,
    map = work.map;
  map.DrainageElevations.set(map.Elevation);
  addTerrainProfile(work, {
    id: "lowland",
    points: [[0, 0]],
    widths: [60_000],
    values: { elevation: [100] },
    operation: "lower",
  });
  bakeFinishedTerrain(work);
  for (let i = 0; i < map.mesh.count; i++)
    expect(map.DrainageElevations[i]).toBeCloseTo(map.Elevation[i], 7);
});

it("establishes a varied summit hierarchy rather than applying one uniform height boost", () => {
  const state = macroFixture(),
    work = state.physical!,
    map = work.map;
  map.RidgeInfluence.fill(1);
  composeRanges(state, 42);
  const peaks = work.finishing!.profiles.filter((p) => p.id.startsWith("summit:"));
  expect(peaks.length).toBeGreaterThan(1);
  const heights = peaks.map((p) => p.values.elevation[0]);
  expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(100);
  expect(heights.every(Number.isFinite)).toBe(true);
  expect(work.finishing!.passes.length).toBeGreaterThan(0);
  projectNative(state);
  publishMacroFeatures(state);
  expect(Object.values(state.domain.world.features).some((f) => f.kind === "peak")).toBe(true);
  expect(Object.values(state.domain.world.features).some((f) => f.kind === "pass")).toBe(true);
});

it("closes small regional holes while retaining a lagoon and a habitat barrier", () => {
  const state = macroFixture(),
    mesh = state.physical!.map.mesh,
    small = nearestTriangle(mesh, 50_000, 0),
    lagoon = nearestTriangle(mesh, -20_000, 0),
    mask = Uint8Array.from(mesh.x, (x, i) =>
      Number(
        Math.hypot(x, mesh.y[i]) < 85_000 &&
          i !== small &&
          Math.hypot(x + 20_000, mesh.y[i]) > 22_000
      )
    );
  const result = reconstructRegion(mesh, mask, (i) => i !== lagoon, 10_000).mask;
  expect(result[small]).toBe(1);
  expect(result[lagoon]).toBe(0);
});

it("composes woodland openings by exchanging actual communities without growing another epoch", () => {
  const state = macroFixture(),
    work = state.physical!,
    map = work.map,
    mesh = map.mesh,
    hole = nearestTriangle(mesh, 0, 0);
  map.BroadleafCover.fill(0.8);
  map.TreeCover.fill(0.8);
  map.GrassCover[hole] = 0.8;
  map.TreeCover[hole] = map.BroadleafCover[hole] = 0;
  const before = map.BroadleafCover.reduce((sum, value, i) => sum + value * mesh.areas[i], 0);
  composeBiologicalRegions(work);
  expect(map.TreeCover[hole]).toBeGreaterThan(0.4);
  expect(map.BroadleafCover.reduce((sum, value, i) => sum + value * mesh.areas[i], 0)).toBeCloseTo(
    before,
    -2
  );
  expect(map.CompletedEpochCount).toBe(0);
});

it("reshapes a river beyond its mesh route and fits a descending channel into the same terrain", () => {
  const state = macroFixture(),
    work = state.physical!,
    map = work.map,
    mesh = map.mesh;
  for (let i = 0; i < mesh.count; i++) {
    map.Elevation[i] = (300 - mesh.x[i] * 0.001) * 1024;
    map.BedrockElevation[i] = map.DrainageElevations[i] = map.Elevation[i];
    map.DrainageBasinIds[i] = 1;
  }
  const a = nearestTriangle(mesh, -80_000, 0),
    b = nearestTriangle(mesh, 80_000, 0),
    center = nearestTriangle(mesh, 0, 0),
    route = crossingPath(work, a, b, center, 150_000);
  for (let n = 0; n < route.length - 1; n++) {
    const i = route[n];
    map.FlowTargets[i] = route[n + 1];
    map.RiverOrders[i] = 3;
    map.RiverWidth[i] = 200;
    map.RiverDepth[i] = 4;
  }
  beginFinishing(work, state.surface);
  const paths = composeRiverNetwork(state, 42),
    curve = paths.reaches!.get(a)!;
  expect(curve.points.length).toBeGreaterThan(route.length);
  expect(
    Math.max(
      ...curve.points.map(([x, y]) =>
        Math.min(...route.map((i) => Math.hypot(x - mesh.x[i], y - mesh.y[i])))
      )
    )
  ).toBeGreaterThan(1000);
  bakeFinishedTerrain(work);
  projectNative(state);
  const read = fieldInterpolator(state.surface, "elevation"),
    heights = curve.points.map(([x, y]) => read({ x, y, z: 0 }));
  for (let n = 1; n < heights.length - 1; n++)
    expect(heights[n]).toBeLessThanOrEqual(heights[n - 1] + 0.001);
});
