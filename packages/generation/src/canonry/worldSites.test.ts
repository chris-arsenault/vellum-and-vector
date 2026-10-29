import { expect, it } from "vitest";
import { spatial } from "@atlas/domain";
import { worldGeographyFixture } from "./worldGeographyFixtures";
import { extractLakes, extractNamedLandforms } from "./geographicRegions";
import { extractReliefFeatures } from "./reliefFeatures";
import { significantSummit } from "./worldSiteEvidence";
import { Landform } from "./codes";
import { initializeMagic } from "./magicState";
import { classifyMagicFeatures } from "./magicFeatures";
import { extractMagicPlaces } from "./geographicRegions";
import { retainedArray } from "./physicalNumerics";

it("keeps a small lake physical while omitting its World name", () => {
  const state = worldGeographyFixture(),
    map = state.physical!.map;
  map.WaterKindCodes.set(20, 2);
  map.WaterBodyIds.set(20, 1);
  map.Elevation.set(20, 0);
  map.WaterSurfaceElevations.set(20, 10 * 1024);
  map.WaterDepths.set(20, 10 * 1024);
  extractLakes(state);
  expect(Object.values(state.domain.world.features).filter((f) => f.kind === "lake")).toEqual([]);
  expect(state.surface.lakes).toHaveLength(1);
  expect(spatial.area(state.surface.lakes![0].geometry)).toBeGreaterThan(0);
  expect(map.WaterKindCodes.get(20)).toBe(2);
  state.domain.world.areas.area.profile = "region";
  extractLakes(state);
  expect(Object.values(state.domain.world.features).filter((f) => f.kind === "lake")).toHaveLength(
    1
  );
});
it("distinguishes great falls by water transport, leaving the physical drop unchanged", () => {
  const state = worldGeographyFixture(),
    map = state.physical!.map;
  map.LandformCodes.set(20, Landform.Waterfall);
  map.FlowTargets.set(20, 21);
  map.Elevation.set(20, 200 * 1024);
  map.FlowAccumulation.set(20, 10);
  extractNamedLandforms(state);
  expect(Object.values(state.domain.world.features)).toEqual([]);
  map.FlowAccumulation.set(20, 2_000);
  extractNamedLandforms(state);
  const falls = Object.values(state.domain.world.features);
  expect(falls).toHaveLength(1);
  expect(falls[0].geometry.type).toBe("Point");
  expect(falls[0].footprint).toBeUndefined();
  expect(map.Elevation.get(20)).toBe(200 * 1024);
});
it("recognizes an isolated mountain and rejects an ordinary subsidiary peak", () => {
  const state = worldGeographyFixture(),
    map = state.physical!.map;
  map.Elevation.set(20, 2_000 * 1024);
  map.LandformCodes.set(20, Landform.Peak);
  expect(significantSummit(state, 20, 1_200)).toBe(true);
  const neighbor = map.mesh.neighbor(20, 0);
  map.Elevation.set(neighbor, 2_100 * 1024);
  expect(significantSummit(state, 20, 1_200)).toBe(false);
  map.Elevation.set(neighbor, 100 * 1024);
  extractReliefFeatures(state);
  expect(Object.values(state.domain.world.features).filter((f) => f.kind === "peak")).toHaveLength(
    1
  );
  state.domain.world.features = {};
  map.Elevation.set(20, 500 * 1024);
  extractReliefFeatures(state);
  expect(Object.values(state.domain.world.features).filter((f) => f.kind === "peak")).toEqual([]);
});

it("requires exceptional causal evidence for a small magical source and preserves its stocks", () => {
  const state = worldGeographyFixture(),
    map = state.physical!.map;
  initializeMagic(state);
  const fire = state.physical!.magic!.fields.find((f) => f.definition.id === "fire")!;
  fire.source.set(20, 350);
  fire.intensity.set(20, 900);
  map.Geothermal.set(20, 500);
  classifyMagicFeatures(state);
  extractMagicPlaces(state);
  expect(Object.values(state.domain.world.features).filter((f) => f.kind === "fire:core")).toEqual(
    []
  );
  fire.source.set(20, 800);
  const stocks = Object.values(fire.stocks).map((stock) => stock.toArray());
  classifyMagicFeatures(state);
  extractMagicPlaces(state);
  expect(
    Object.values(state.domain.world.features).filter((f) => f.kind === "fire:core")
  ).toHaveLength(1);
  expect(Object.values(fire.stocks).map((stock) => stock.toArray())).toEqual(stocks);
});
it("does not substitute an area for a magical course whose physical links are absent", () => {
  const state = worldGeographyFixture(),
    map = state.physical!.map;
  initializeMagic(state);
  const fire = state.physical!.magic!.fields.find((f) => f.definition.id === "fire")!;
  fire.features.vein = retainedArray(map, "uint8", "test:vein").fill(1);
  fire.coverage.vein = retainedArray(map, "float64", "test:vein-coverage").fill(1);
  extractMagicPlaces(state);
  expect(Object.values(state.domain.world.features)).toEqual([]);
  fire.parents = retainedArray(map, "int32", "test:vein-parents").fill(-1);
  for (let i = 0; i < map.mesh.count; i++) fire.parents.set(i, map.mesh.neighbor(i, 0));
  extractMagicPlaces(state);
  const courses = Object.values(state.domain.world.features);
  expect(courses.length).toBeGreaterThan(0);
  expect(courses.every((f) => f.geometry.type.includes("LineString"))).toBe(true);
});
