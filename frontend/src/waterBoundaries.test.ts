import { expect, it } from "vitest";
import {
  createGrid,
  fieldInterpolator,
  gridSchema,
  point,
  rectangle,
  spatial,
} from "@atlas/domain";
import { landscape } from "../../packages/generation/src/mapFixtures";
import { createField } from "../../packages/generation/src/canonry/field";
import { createWorldMesh } from "../../packages/generation/src/canonry/worldMesh";
import { atlasPhysicalProfile } from "../../packages/generation/src/canonry/atlasProfile";
import { refreshWorkspaceSamples } from "../../packages/generation/src/canonry/atlasWorkspace";
import { projectNative } from "../../packages/generation/src/canonry/atlasProjection";
import {
  oceanFootprint,
  lakeFootprint,
} from "../../packages/generation/src/canonry/geographicContours";
import { nearestTriangle } from "../../packages/generation/src/canonry/mesh";
import { physicalSampler } from "../../packages/generation/src/canonry/physicalMetric";
import { createRiverPaths, riverPath } from "../../packages/generation/src/canonry/riverPaths";
import { numericTileSampler } from "./numericTiles";
import { tilePainter } from "./rasterTiles";
import type { Raster } from "./types";

function fixture(pattern: "plane" | "coast" | "island") {
  const state = landscape(),
    footprint = rectangle([-100_000, -100_000, 100_000, 100_000]);
  state.domain.scope.footprint = footprint;
  state.surface = createGrid("coast", state.domain.scope, 7, 5);
  const map = createField(createWorldMesh([-100_000, -100_000, 100_000, 100_000], 512, 25_000));
  map.BaseSeaLevel = 20 * 1024;
  map.EffectiveSeaLevel = 100 * 1024;
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x(i),
      y = map.mesh.y(i);
    const relief =
      pattern === "island"
        ? 700 - (x * x + y * y) * 0.0000001
        : x * 0.01 + (pattern === "coast" ? 500 * Math.sin(y / 15_000) : 0);
    map.Elevation.set(i, (100 + relief) * 1024);
    map.WaterKindCodes.set(i, Number(map.Elevation.get(i) < map.EffectiveSeaLevel));
    map.WaterSurfaceElevations.set(i, map.EffectiveSeaLevel);
  }
  state.physical = {
    map,
    profile: atlasPhysicalProfile(),
    samples: state.surface.coverage.scratch("int32", "physical:samples", 0),
    grid: state.surface.coverage,
    fixed: [],
    inherited: false,
    sampling: { maximumSize: map.mesh.spacing, minimumSize: map.mesh.spacing, featureSamples: 2 },
  };
  refreshWorkspaceSamples(state, state.physical);
  projectNative(state);
  state.surface.ocean = oceanFootprint(state);
  const raster: Raster = {
    id: "coast",
    areaId: "area",
    footprint,
    bounds: state.surface.bounds,
    channel: "elevation",
    field: state.surface,
    water: state.surface,
  };
  return { state, map, raster };
}

it.each(["plane", "coast", "island"] as const)(
  "retains the physical %s shoreline through coarse publication and numeric tiles",
  (pattern) => {
    const { state, map, raster } = fixture(pattern),
      ocean = state.surface.ocean!,
      covers = spatial.pointCoverage(ocean),
      height = physicalSampler(map.mesh, map.Elevation),
      sample = numericTileSampler(raster);
    expect(() => gridSchema.parse(state.surface)).not.toThrow();
    for (let y = -90_000; y <= 90_000; y += 11000)
      for (let x = -90_000; x <= 90_000; x += 13000) {
        const native = height(x, y) - map.EffectiveSeaLevel;
        if (Math.abs(native) < 1) continue;
        const p = { x, y, z: 0 },
          wet = native < 0;
        expect(covers(p)).toBe(wet);
        expect(sample([x - 0.5, y - 0.5, x + 0.5, y + 0.5], 1)[3]).toBe(Number(wet));
      }
    if (pattern === "plane") expect(spatial.area(ocean)).toBeCloseTo(20_000_000_000, 1);
  }
);

it("meets the shared coastline even where resampled elevation puts the mouth inland", () => {
  const { state, map, raster } = fixture("coast"),
    mesh = map.mesh,
    paths = createRiverPaths(map),
    ocean = state.surface.ocean!;
  paths.water = { ocean, lakes: new Map() };
  const height = fieldInterpolator(state.surface, "elevation"),
    sea = fieldInterpolator(state.surface, "seaLevel"),
    sample = numericTileSampler(raster),
    paint = tilePainter(raster, [-2000, 2000]);
  let exposedMouths = 0;
  for (let i = 0; i < mesh.count; i++) {
    if (mesh.membership(i) !== 1) continue;
    if (map.WaterKindCodes.get(i)) continue;
    const j = Array.from({ length: mesh.degree(i) }, (_, e) => mesh.neighbor(i, e)).find(
      (j) => j >= 0 && map.WaterKindCodes.get(j) === 1
    );
    if (j === undefined) continue;
    if (Math.abs(mesh.x(j)) > 90_000 || Math.abs(mesh.y(j)) > 90_000) continue;
    const result = riverPath(map, paths, [i, j]),
      end = result.geometry.coordinates.at(-1)!,
      p = { x: end[0], y: end[1], z: 0 };
    expect(spatial.distance(ocean, point(p))).toBeLessThan(0.00001);
    const dx = mesh.x(j) - p.x,
      dy = mesh.y(j) - p.y,
      length = Math.hypot(dx, dy),
      x = p.x + dx / length,
      y = p.y + dy / length;
    expect(sample([x - 0.5, y - 0.5, x + 0.5, y + 0.5], 1)[3]).toBe(1);
    const pixel = paint([x - 0.5, y - 0.5, x + 0.5, y + 0.5], 1);
    expect(pixel[2]).toBeGreaterThan(pixel[0]);
    if (height(p) - sea(p) > 1) exposedMouths++;
    for (const values of Object.values(result.profiles))
      expect(values).toHaveLength(result.geometry.coordinates.length);
  }
  expect(exposedMouths).toBeGreaterThan(0);
});

it("retains a shallow lake inlet smaller than the local contour grid", () => {
  const { state, map, raster } = fixture("plane"),
    mesh = map.mesh,
    i = nearestTriangle(mesh, 0, 0),
    level = 100 * 1024;
  map.Elevation.fill(level + 1000 * 1024);
  map.Elevation.set(i, level - 1024);
  map.WaterKindCodes.fill(0);
  map.WaterKindCodes.set(i, 2);
  map.WaterBodyIds.fill(0);
  map.WaterBodyIds.set(i, 7);
  map.WaterSurfaceElevations.set(i, level);
  const shape = lakeFootprint(state, [i], 7, level)!;
  expect(shape).toBeTruthy();
  expect(spatial.pointCoverage(shape)({ x: mesh.x(i), y: mesh.y(i), z: 0 })).toBe(true);
  const j = mesh.neighbor(i, 0),
    paths = createRiverPaths(map);
  paths.water = { ocean: null, lakes: new Map([[7, shape]]) };
  const end = riverPath(map, paths, [j, i]).geometry.coordinates.at(-1)!,
    p = { x: end[0], y: end[1], z: 0 };
  expect(spatial.distance(shape, point(p))).toBeLessThan(0.00001);
  raster.lakes = [{ geometry: shape, level: (level - map.BaseSeaLevel) / 1024 }];
  expect(
    numericTileSampler(raster)(
      [mesh.x(i) - 0.5, mesh.y(i) - 0.5, mesh.x(i) + 0.5, mesh.y(i) + 0.5],
      1
    )[3]
  ).toBe(2);
});
