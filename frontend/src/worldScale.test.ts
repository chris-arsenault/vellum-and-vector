import { expect, it } from "vitest";
import { generateAtlas } from "@atlas/generation";
import { spatial } from "@atlas/domain";
import { createWorld, session } from "./atlasState";

async function measuredWorld(quality: string) {
  const world = createWorld({
    name: "Physical world",
    seed: 104729,
    width: 4_000_000,
    height: 2_000_000,
  });
  const started = performance.now();
  const result = await generateAtlas(session(world.id).snapshot, {
    areaId: Object.keys(world.areas)[0],
    seed: world.seed,
    quality,
    domains: ["physical", "magic"],
  });
  const grid = result.state.surface;
  const features = Object.values(result.state.domain.world.features);
  const rivers = features.filter((feature) => feature.kind === "river");
  expect(rivers.length).toBeGreaterThan(0);
  let discharge = 0,
    width = 0,
    depth = 0;
  for (const river of rivers) {
    expect(river.geometry.type).toBe("LineString");
    if (river.geometry.type !== "LineString") continue;
    for (const key of ["widths", "depths", "discharges", "catchmentAreas"]) {
      const profile = river.attributes[key] as number[];
      expect(profile.length).toBe(river.geometry.coordinates.length);
      expect(profile.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    }
    for (const value of river.attributes.discharges as number[])
      discharge = Math.max(discharge, value);
    for (const value of river.attributes.widths as number[]) width = Math.max(width, value);
    for (const value of river.attributes.depths as number[]) depth = Math.max(depth, value);
  }
  expect(grid.bounds).toEqual([0, 0, 4_000_000, 2_000_000]);
  expect(grid.units.catchmentArea).toBe("square-metre");
  expect(grid.units.flow).toBe("cubic-metre/second");
  expect(grid.units.riverWidth).toBe("metre");
  expect(result.state.history).toHaveLength(3);
  for (const id of ["fire", "aurora", "pressure"])
    expect(grid.channels[`magic:${id}:history`].some((value) => value > 0)).toBe(true);
  const craters = features.filter((feature) => feature.kind === "crater");
  expect(craters.length).toBeGreaterThan(0);
  expect(craters.every((feature) => spatial.area(feature.geometry) > 0)).toBe(true);
  const radii = craters
    .map((feature) => [feature.attributes.causeId, feature.attributes.radius])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  const elevation = grid.channels.elevation;
  const summary = {
    quality,
    seconds: Math.round((performance.now() - started) / 100) / 10,
    riverCount: rivers.length,
    discharge,
    width,
    depth,
    relief:
      elevation.reduce((max, value) => Math.max(max, value), -Infinity) -
      elevation.reduce((min, value) => Math.min(min, value), Infinity),
    landShare:
      grid.channels.water.reduce((sum, value) => sum + Number(value === 0), 0) / elevation.length,
  };
  console.log("World scale comparison", summary);
  return { ...summary, radii };
}

it("keeps continental geography, crater sizes and major river dimensions at Standard and Fine", async () => {
  const standard = await measuredWorld("standard"),
    fine = await measuredWorld("fine");
  expect(fine.radii).toEqual(standard.radii);
  expect(Math.abs(fine.landShare - standard.landShare)).toBeLessThan(0.15);
  expect(fine.width / standard.width).toBeGreaterThan(0.6);
  expect(fine.width / standard.width).toBeLessThan(1.7);
  expect(fine.discharge / standard.discharge).toBeGreaterThan(0.4);
  expect(fine.discharge / standard.discharge).toBeLessThan(2.5);
  expect(fine.relief / standard.relief).toBeGreaterThan(0.7);
}, 600000);
