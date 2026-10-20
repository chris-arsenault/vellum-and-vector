import { expect, it } from "vitest";
import { fieldInterpolator, gridPosition, spatial } from "@atlas/domain";
import { macroFixture } from "./macroFixtures";
import { beginFinishing, bakeFinishedTerrain } from "./macroTerrain";
import { composeWaterBodies, reconcileFinishedWater } from "./macroWater";
import { projectNative } from "./atlasProjection";
import { composeIceBodies } from "./macroIce";
import { shapeRiverDrops } from "./macroDrops";
import { Landform } from "./codes";
import { crossingReaches } from "./macroNetwork";

it("publishes one composed shoreline for geometric and numerical water reads", () => {
  const state = macroFixture(),
    work = state.physical!,
    map = work.map;
  for (let i = 0; i < map.mesh.count; i++) {
    map.Elevation[i] = (40_000 - map.mesh.x[i] + Math.sin(map.mesh.y[i] / 6000) * 3000) * 10;
    map.BedrockElevation[i] = map.Elevation[i];
    if (map.Elevation[i] < 0) {
      map.WaterKindCodes[i] = map.WaterBodyIds[i] = 1;
      map.WaterSurfaceElevations[i] = 0;
      map.WaterDepths[i] = -map.Elevation[i];
    }
  }
  beginFinishing(work, state.surface);
  composeWaterBodies(state);
  bakeFinishedTerrain(work);
  reconcileFinishedWater(work);
  projectNative(state);
  const ocean = spatial.pointCoverage(state.surface.ocean!),
    wet = fieldInterpolator(state.surface, "water"),
    depth = fieldInterpolator(state.surface, "waterDepth"),
    height = fieldInterpolator(state.surface, "elevation");
  for (let i = 0; i < state.surface.active.length; i++) {
    const p = gridPosition(state.surface, i);
    if (!state.surface.active[i]) continue;
    expect(wet(p)).toBe(ocean(p) && height(p) < 0 ? 1 : 0);
    if (wet(p)) expect(depth(p)).toBeCloseTo(-height(p), 6);
  }
});

it("connects inherited ice without adding ice volume or covering a warm opening", () => {
  const work = macroFixture().physical!,
    map = work.map,
    mesh = map.mesh;
  map.Temperature.fill(200);
  let hole = -1,
    warm = -1;
  for (let i = 0; i < mesh.count; i++) {
    if (Math.hypot(mesh.x[i], mesh.y[i]) < 70_000) map.IceThickness[i] = 100;
    if (Math.hypot(mesh.x[i], mesh.y[i]) < mesh.spacing && hole < 0) hole = i;
    if (Math.hypot(mesh.x[i] - 30_000, mesh.y[i]) < mesh.spacing && warm < 0) warm = i;
  }
  map.IceThickness[hole] = map.IceThickness[warm] = 0;
  map.Temperature[warm] = 450;
  const volume = () => map.IceThickness.reduce((sum, value, i) => sum + value * mesh.areas[i], 0),
    before = volume();
  composeIceBodies(work);
  expect(map.IceThickness[hole]).toBeGreaterThan(0);
  expect(map.IceThickness[warm]).toBe(0);
  expect(volume() / before).toBeCloseTo(1, 10);
});

it("retains one exact lake level across content and numerical halo without a datum round trip", () => {
  const state = macroFixture(),
    work = state.physical!,
    map = work.map,
    level = 920909.5493503013;
  map.BaseSeaLevel = -222878.0068419251;
  map.mesh.contentCount = map.mesh.count - 1;
  map.Elevation.fill(level - 100 * 1024);
  map.WaterKindCodes.fill(2);
  map.WaterBodyIds.fill(2);
  map.WaterSurfaceElevations.fill(level);
  map.WaterDepths.fill(100 * 1024);
  work.finishing!.lakes.set(2, { footprint: state.domain.scope.footprint, level });
  reconcileFinishedWater(work);
  expect(map.WaterSurfaceElevations.every((value) => value === level)).toBe(true);
});

it("concentrates a supported waterfall drop while retaining its total fall", () => {
  const work = macroFixture().physical!,
    map = work.map,
    members = [0, 1, 2];
  map.LandformCodes[1] = Landform.Waterfall;
  map.mesh.x.set([0, 10_000, 20_000]);
  map.mesh.y.set([0, 0, 0]);
  map.DrainageElevations.set([200 * 1024, 150 * 1024, 100 * 1024]);
  map.RiverWidth[1] = 20;
  const curve = {
      positions: [0, 1, 2],
      points: [
        [0, 0],
        [10_000, 0],
        [20_000, 0],
      ] as [number, number][],
    },
    bed = shapeRiverDrops(work, members, curve);
  expect(curve.positions.length).toBe(5);
  expect(bed(0.99, 150 * 1024)).toBe(200 * 1024);
  expect(bed(1.01, 150 * 1024)).toBe(100 * 1024);
});

it("detects accidental network crossings but retains shared confluences", () => {
  expect(
    crossingReaches(
      [
        {
          points: [
            [0, 0],
            [10, 10],
          ],
        },
        {
          points: [
            [0, 10],
            [10, 0],
          ],
        },
      ],
      5
    ).size
  ).toBe(2);
  expect(
    crossingReaches(
      [
        {
          points: [
            [0, 0],
            [10, 10],
          ],
        },
        {
          points: [
            [0, 10],
            [10, 10],
          ],
        },
      ],
      5
    ).size
  ).toBe(0);
});
