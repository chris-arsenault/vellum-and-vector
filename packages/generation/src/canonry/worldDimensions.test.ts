import { expect, it } from "vitest";
import { createWorldMesh } from "./worldMesh";
import { nearestTriangle } from "./mesh";
import { atlasPhysicalProfile } from "./atlasProfile";
import { createField } from "./field";
import { physicalContext } from "./context";
import { impactCratering } from "./impacts";
import { createProvinceSites } from "./provinceSites";
import { contributingArea } from "./flowGraph";
import { riverNetwork } from "./rivers";
import { riverChannelGeometry } from "./channelGeometry";
import { secondsPerYear } from "./dimensions";
import { smoothMetric } from "./metricSmoothing";

it("keeps physical parameters independent of Standard and Fine sampling", () => {
  expect(atlasPhysicalProfile().ImpactMinimumRadius).toBe(50_000);
  expect(atlasPhysicalProfile().ContinentalTransitionWidth).toBe(260_000);
});

it("keeps geological sources and crater radii in world space as sampling changes", () => {
  const worlds = [4096, 16384].map((samples) => {
    const map = createField(createWorldMesh([0, 0, 2_000_000, 1_000_000], samples, 100_000));
    const context = physicalContext(157, 0, atlasPhysicalProfile());
    const sites = createProvinceSites(map, context);
    impactCratering(map, context);
    return { sites, events: map.events };
  });
  expect(worlds[0]).toEqual(worlds[1]);
  expect(worlds[0].events.length).toBeGreaterThan(0);
  expect(worlds[0].events.every((event) => event.radius >= 50_000)).toBe(true);
});

it("represents the actual rectangular world area and metric neighbor distances", () => {
  const bounds: [number, number, number, number] = [200_000, 400_000, 600_000, 500_000];
  for (const samples of [4096, 16384]) {
    const mesh = createWorldMesh(bounds, samples, 20_000);
    expect(mesh.areas.slice(0, mesh.contentCount).reduce((sum, area) => sum + area, 0)).toBeCloseTo(
      40_000_000_000,
      -2
    );
    for (const [x, y] of [
      [-200_000, -50_000],
      [200_000, 50_000],
      [0, 0],
    ]) {
      const i = nearestTriangle(mesh, x, y);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(Math.hypot(mesh.x[i] - x, mesh.y[i] - y)).toBeLessThan(mesh.spacing);
    }
    const i = Math.floor(mesh.contentCount / 2);
    expect(mesh.edgeLength[i * 3]).toBeCloseTo(mesh.spacing, 6);
  }
});

it("routes the same catchment runoff volume at different sampling densities", () => {
  for (const samples of [1024, 4096]) {
    const map = createField(createWorldMesh([0, 0, 100_000, 100_000], samples, 0));
    const p = atlasPhysicalProfile();
    p.RiverMinimumBasinDischarge = Infinity;
    map.Runoff.fill(500);
    for (let i = 0; i < map.mesh.count - 1; i++) map.FlowTargets[i] = i + 1;
    riverNetwork(map, physicalContext(1, 0, p));
    expect(map.CatchmentArea.at(-1)).toBeCloseTo(10_000_000_000, -2);
    expect(map.FlowAccumulation.at(-1)).toBeCloseTo(5_000_000_000 / secondsPerYear, 8);
  }
  expect([...contributingArea(new Int32Array([2, 2, -1]), new Float64Array([10, 20, 30]))]).toEqual(
    [10, 20, 60]
  );
});

it("retains metre-wide channels below the terrain cell size", () => {
  const widths: number[] = [];
  for (const samples of [1024, 4096]) {
    const map = createField(createWorldMesh([0, 0, 100_000, 100_000], samples, 0));
    map.RiverOrders[0] = 3;
    map.FlowAccumulation[0] = 1000;
    map.RockResistance.fill(1000);
    map.Slope.fill(0.001);
    riverChannelGeometry(map, physicalContext(1, 0, atlasPhysicalProfile()));
    widths.push(map.RiverWidth[0]);
    expect(map.RiverWidth[0]).toBeGreaterThan(50);
    expect(map.RiverWidth[0]).toBeLessThan(300);
    expect(map.RiverDepth[0]).toBeGreaterThan(1);
    expect(map.RiverWidth[0]).toBeLessThan(map.mesh.spacing);
  }
  expect(widths[0]).toBe(widths[1]);
});

it("spreads regional support over the same physical reach with finer sampling", () => {
  const radii: number[] = [];
  for (const samples of [4096, 16384]) {
    const mesh = createWorldMesh([-150_000, -150_000, 150_000, 150_000], samples, 0);
    const input = Float64Array.from(mesh.x, (x, i) =>
      Math.exp(-(x * x + mesh.y[i] ** 2) / (2 * 10_000 ** 2))
    );
    const output = smoothMetric(mesh, input, 15_000);
    const mass = output.reduce((sum, value) => sum + value, 0);
    expect(mass).toBeCloseTo(
      input.reduce((sum, value) => sum + value, 0),
      4
    );
    const moment =
      output.reduce((sum, value, i) => sum + value * (mesh.x[i] ** 2 + mesh.y[i] ** 2), 0) / mass;
    radii.push(Math.sqrt(moment));
  }
  expect(radii[1] / radii[0]).toBeGreaterThan(0.9);
  expect(radii[1] / radii[0]).toBeLessThan(1.1);
  expect(radii[0]).toBeGreaterThan(25_000);
});
