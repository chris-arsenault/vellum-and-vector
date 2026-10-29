import { expect, it } from "vitest";
import { point, spatial, classInterpolator, putChannel, biomeCode } from "@atlas/domain";
import { extractEcologicalFeatures } from "./ecologyFeatures";
import { classifyBiome } from "./ecologyEnvironment";
import { partitionWorldRegion } from "./worldRegionPartition";
import { regionEvidence } from "./worldRegionEvidence";
import { worldGeographyFixture } from "./worldGeographyFixtures";
import { extractReliefFeatures } from "./reliefFeatures";
import { extractOceans } from "./oceanFeatures";
import { oceanFootprint } from "./geographicContours";

function classifiedForest(size = 25_000) {
  const state = worldGeographyFixture(undefined, size),
    map = state.physical!.map;
  for (let i = 0; i < map.mesh.count; i++) {
    const trees = map.mesh.x(i) + map.mesh.origin[0] < 300_000 ? 0.1 : 0.8;
    map.TreeCover.set(i, trees);
    map.BroadleafCover.set(i, trees);
    map.GrassCover.set(i, 0.8 - trees);
    map.BiomeCodes.set(i, classifyBiome(map, i));
  }
  putChannel(state.surface, "biome", "category", map.BiomeCodes);
  return state;
}

it("keeps a broad forest whole and aligns its margin with the unchanged categorical raster", () => {
  const state = classifiedForest(),
    before = state.physical!.map.BiomeCodes.toArray();
  const raster = classInterpolator(state.surface, "biome");
  extractEcologicalFeatures(state);
  const forest = Object.values(state.domain.world.features).filter((f) => f.kind === "forest");
  expect(forest).toHaveLength(1);
  for (const x of [290_000, 310_000, 340_000, 550_000]) {
    const p = { x, y: 210_000, z: 0 };
    expect(spatial.intersects(forest[0].geometry, point(p))).toBe(x > 300_000);
    expect(raster(p)).toBe(biomeCode(x > 300_000 ? "Temperate forest" : "Grassland"));
  }
  expect(state.physical!.map.BiomeCodes.toArray()).toEqual(before);
});

it("does not name an isolated local forest patch or fill the rest of the map with forest", () => {
  const state = classifiedForest(),
    map = state.physical!.map;
  map.TreeCover.fill(0.1);
  map.BroadleafCover.fill(0.1);
  map.GrassCover.fill(0.7);
  map.TreeCover.set(0, 0.8);
  map.BroadleafCover.set(0, 0.8);
  map.GrassCover.set(0, 0);
  for (let i = 0; i < map.mesh.count; i++) map.BiomeCodes.set(i, classifyBiome(map, i));
  extractEcologicalFeatures(state);
  expect(Object.values(state.domain.world.features).filter((f) => f.kind === "forest")).toEqual([]);
  expect(map.TreeCover.get(0)).toBe(0.8);
});

it("recognizes one wetland complex despite differences between marsh and swamp", () => {
  const state = worldGeographyFixture(),
    map = state.physical!.map;
  map.FloodplainIntensity.fill(800);
  map.WetlandCover.fill(0.6);
  for (let i = 0; i < map.mesh.count; i++) {
    const tree = map.mesh.x(i) + map.mesh.origin[0] < 300_000 ? 0.1 : 0.3;
    map.TreeCover.set(i, tree);
    map.BroadleafCover.set(i, tree);
    map.BiomeCodes.set(i, classifyBiome(map, i));
  }
  extractEcologicalFeatures(state);
  expect(
    Object.values(state.domain.world.features).filter((f) => f.kind === "wetland")
  ).toHaveLength(1);
});

it("keeps geographic organization as the same supplied landscape gains numerical samples", () => {
  const extents = [50_000, 25_000].map((size) => {
    const state = classifiedForest(size);
    extractEcologicalFeatures(state);
    const forest = Object.values(state.domain.world.features).filter((f) => f.kind === "forest");
    expect(forest).toHaveLength(1);
    return spatial.bounds(forest[0].geometry);
  });
  expect(extents[0][0]).toBeCloseTo(extents[1][0], 0);
  expect(extents[0][2]).toBeCloseTo(extents[1][2], 0);
});

it("subdivides truly continental quiet country into substantial connected provinces", () => {
  const state = worldGeographyFixture([0, 0, 2_000_000, 1_000_000], 100_000),
    map = state.physical!.map,
    members = Int32Array.from({ length: map.mesh.count }, (_, i) => i);
  const pieces = partitionWorldRegion(state, members, 2e12);
  expect(pieces.length).toBeGreaterThan(1);
  expect(pieces.reduce((n, p) => n + p.length, 0)).toBe(members.length);
  for (const piece of pieces) {
    expect(regionEvidence(map, piece).area).toBeGreaterThan(100e9);
    const seen = new Set([piece[0]]),
      allowed = new Set(piece);
    for (const cell of seen)
      for (let edge = 0; edge < map.mesh.degree(cell); edge++) {
        const other = map.mesh.neighbor(cell, edge);
        if (allowed.has(other)) seen.add(other);
      }
    expect(seen.size).toBe(piece.length);
  }
  expect(state.diagnostics ?? []).toEqual([]);
});

it("keeps a mountain system across minor valleys but does not call a flat plateau a range", () => {
  const state = worldGeographyFixture(),
    map = state.physical!.map;
  for (let i = 0; i < map.mesh.count; i++) {
    const x = map.mesh.x(i) + map.mesh.origin[0],
      y = map.mesh.y(i) + map.mesh.origin[1];
    map.Elevation.set(
      i,
      (x > 100_000 && x < 500_000 ? 1_500 + 1_000 * Math.abs(Math.sin(y / 50_000)) : 100) * 1024
    );
  }
  extractReliefFeatures(state);
  expect(Object.values(state.domain.world.features).filter((f) => f.kind === "range")).toHaveLength(
    1
  );
  state.domain.world.features = {};
  map.Elevation.fill(2_000 * 1024);
  extractReliefFeatures(state);
  expect(Object.values(state.domain.world.features).filter((f) => f.kind === "range")).toHaveLength(
    0
  );
});

it("leaves a small marine pocket unnamed without removing its physical water", () => {
  const state = worldGeographyFixture(),
    map = state.physical!.map;
  map.Elevation.set(0, -100 * 1024);
  map.WaterKindCodes.set(0, 1);
  map.WaterDepths.set(0, 100 * 1024);
  state.surface.ocean = oceanFootprint(state);
  const water = structuredClone(state.surface.ocean);
  extractOceans(state);
  expect(Object.values(state.domain.world.features).filter((f) => f.kind === "ocean")).toEqual([]);
  expect(state.surface.ocean).toEqual(water);
  expect(map.WaterKindCodes.get(0)).toBe(1);
});
