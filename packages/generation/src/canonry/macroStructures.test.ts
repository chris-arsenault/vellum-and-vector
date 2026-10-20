import { expect, it } from "vitest";
import { macroFixture } from "./macroFixtures";
import { beginFinishing, finishedElevation } from "./macroTerrain";
import { composeGeologicalEvents, composeFaults } from "./macroEvents";
import { composeStructuralRegions } from "./macroStructures";
import { extractGeologicalEvents } from "./geologicalFeatures";

it("retains shared fault junctions and fits inherited relief to the moved trace", () => {
  const work = macroFixture().physical!,
    before = finishedElevation(work);
  work.map.faults = [
    {
      id: "main",
      width: 10_000,
      coordinates: [
        [-70_000, 0],
        [-30_000, 8000],
        [0, 0],
        [30_000, -8000],
        [70_000, 0],
      ],
    },
    {
      id: "branch",
      width: 10_000,
      coordinates: [
        [0, 0],
        [0, 70_000],
      ],
    },
  ];
  const sourceHeight = before(-30_000, 8000);
  composeFaults(work, 42);
  expect(work.map.faults[0].coordinates[2]).toEqual(work.map.faults[1].coordinates[0]);
  const [x, y] = work.map.faults[0].coordinates[1];
  expect(Math.abs(finishedElevation(work)(x, y) - sourceHeight)).toBeLessThan(
    Math.abs(before(x, y) - sourceHeight)
  );
});

it("fits an irregular surviving crater footprint and rim instead of publishing an event disk", () => {
  const state = macroFixture(),
    work = state.physical!,
    map = work.map;
  for (let i = 0; i < map.mesh.count; i++) {
    const radius = Math.hypot(map.mesh.x[i], map.mesh.y[i]);
    map.Elevation[i] =
      (400 +
        280 * Math.exp(-(((radius - 30_000) / 8000) ** 2)) -
        150 * Math.exp(-((radius / 20_000) ** 2))) *
      1024;
    map.BedrockElevation[i] = map.Elevation[i];
    map.ImpactExcavation[i] = radius < 30_000 ? 150 * 1024 : 0;
    map.ImpactRimUplift[i] = Math.abs(radius - 30_000) < 12_000 ? 200 * 1024 : 0;
  }
  map.events.push({
    id: "impact:surviving",
    kind: "impact",
    x: 0,
    y: 0,
    radius: 30_000,
    epoch: 0,
    strength: 800,
  });
  beginFinishing(work, state.surface);
  composeGeologicalEvents(work, 42);
  extractGeologicalEvents(state);
  const crater = Object.values(state.domain.world.features).find((f) => f.kind === "crater")!;
  expect(crater).toBeDefined();
  expect(crater.geometry.type).toBe("Polygon");
  if (crater.geometry.type !== "Polygon") throw new Error("Expected crater footprint");
  const radii = crater.geometry.coordinates[0].map(([x, y]) => Math.hypot(x, y));
  expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(1000);
  expect(work.finishing!.profiles.some((p) => p.id.startsWith("rim:"))).toBe(true);
  expect(map.CompletedEpochCount).toBe(0);
});

it("retains an erased event in history without restoring a present-day crater", () => {
  const state = macroFixture(),
    work = state.physical!;
  work.map.Elevation.fill(100 * 1024);
  work.map.BedrockElevation.set(work.map.Elevation);
  work.map.ImpactExcavation.fill(200 * 1024);
  work.map.ImpactRimUplift.fill(100 * 1024);
  beginFinishing(work, state.surface);
  work.map.events.push({
    id: "impact:erased",
    kind: "impact",
    x: 0,
    y: 0,
    radius: 30_000,
    epoch: 0,
    strength: 800,
  });
  composeGeologicalEvents(work, 42);
  extractGeologicalEvents(state);
  expect(work.map.events).toHaveLength(1);
  expect(
    Object.values(state.domain.world.features).filter((f) => f.kind === "crater")
  ).toHaveLength(0);
});

it("keeps a continental shelf profile inside its water support instead of carving through nearby land", () => {
  const state = macroFixture(),
    work = state.physical!,
    map = work.map;
  for (let i = 0; i < map.mesh.count; i++) {
    const wet = map.mesh.x[i] < 0;
    map.Elevation[i] = (wet ? -120 : 300) * 1024;
    map.BedrockElevation[i] = map.Elevation[i];
    map.WaterKindCodes[i] = wet ? 1 : 0;
    map.BathymetricZoneCodes[i] = wet ? 2 : 0;
    map.CoastalMarginCodes[i] = wet ? 1 : 0;
  }
  beginFinishing(work, state.surface);
  const before = finishedElevation(work)(30_000, 0);
  composeStructuralRegions(state);
  expect(work.finishing!.profiles.some((p) => p.id.startsWith("margin:"))).toBe(true);
  expect(finishedElevation(work)(30_000, 0)).toBe(before);
});
