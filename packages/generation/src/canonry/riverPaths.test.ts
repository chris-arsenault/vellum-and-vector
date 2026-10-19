import { expect, it } from "vitest";
import { interpolateProfile, lineParts, rectangle, spatial } from "@atlas/domain";
import { createWorldMesh } from "./worldMesh";
import { createField } from "./field";
import { nearestTriangle } from "./mesh";
import { createRiverPaths, riverPath } from "./riverPaths";

function network() {
  const map = createField(createWorldMesh([-100_000, -100_000, 100_000, 100_000], 1024, 0));
  const index = (u: number, v: number, inverted: boolean) => {
    const i = map.mesh.coords.findIndex((p) => p.u === u && p.v === v && p.inverted === inverted);
    expect(i).toBeGreaterThanOrEqual(0);
    return i;
  };
  const main = Array.from({ length: 13 }, (_, k) => [
    index(k - 6, 0, false),
    index(k - 6, 0, true),
  ]).flat();
  const branch = Array.from({ length: 5 }, (_, k) => [
    index(0, k - 5, false),
    index(0, k - 5, true),
  ]).flat();
  branch.push(index(0, 0, false));
  const join = main.indexOf(branch.at(-1)!);
  for (const [channel, discharge] of [
    [main, 200],
    [branch, 50],
  ] as const)
    channel.forEach((i, station) => {
      map.RiverOrders[i] = 1;
      map.FlowAccumulation[i] = discharge + station;
      map.RiverWidth[i] = 20 + station;
      map.RiverDepth[i] = 2 + station / 10;
      map.CatchmentArea[i] = 1_000_000 * (station + 1);
      map.DrainageElevations[i] = (500 - station) * 1024;
      map.FlowTargets[i] = channel[station + 1] ?? -1;
    });
  // Restore the main-stem junction after the tributary meets it.
  map.FlowTargets[main[join]] = main[join + 1];
  for (let station = join; station < main.length; station++) {
    const i = main[station];
    map.FlowAccumulation[i] = 300 + station;
    map.DrainageElevations[i] = (500 - station) * 1024;
  }
  const mouth = main.at(-1)!;
  map.WaterKindCodes[mouth] = 1;
  map.RiverOrders[mouth] = 0;
  return { map, main, branch, join, mouth };
}
function turns(coordinates: number[][]) {
  return coordinates.slice(1, -1).map((b, i) => {
    const a = coordinates[i],
      c = coordinates[i + 2],
      x = [b[0] - a[0], b[1] - a[1]],
      y = [c[0] - b[0], c[1] - b[1]];
    return Math.acos(
      Math.max(-1, Math.min(1, (x[0] * y[0] + x[1] * y[1]) / (Math.hypot(...x) * Math.hypot(...y))))
    );
  });
}
const length = (coordinates: number[][]) =>
  coordinates
    .slice(1)
    .reduce((sum, p, i) => sum + Math.hypot(p[0] - coordinates[i][0], p[1] - coordinates[i][1]), 0);

it("removes the repeated 60-degree mesh staircase rather than only inserting vertices", () => {
  const { map, main } = network(),
    paths = createRiverPaths(map);
  const raw = main.map((i) => [map.mesh.x[i], map.mesh.y[i]]),
    continuous = riverPath(map, paths, main).geometry.coordinates;
  expect(Math.max(...turns(raw))).toBeCloseTo(Math.PI / 3, 5);
  expect(Math.max(...turns(continuous))).toBeLessThan(Math.PI / 6);
  expect(length(continuous)).toBeLessThan(length(raw) * 0.95);
  expect(continuous[0]).toEqual(raw[0]);
  expect(continuous.at(-1)).toEqual(raw.at(-1));
});

it("shares a relaxed confluence across reaches while continuing the main-stem tangent", () => {
  const { map, main, branch, join } = network(),
    paths = createRiverPaths(map);
  const upstream = riverPath(map, paths, main.slice(0, join + 1)).geometry.coordinates,
    downstream = riverPath(map, paths, main.slice(join)).geometry.coordinates,
    tributary = riverPath(map, paths, branch).geometry.coordinates;
  expect(upstream.at(-1)).toEqual(downstream[0]);
  expect(tributary.at(-1)).toEqual(downstream[0]);
  expect(downstream[0]).not.toEqual([map.mesh.x[main[join]], map.mesh.y[main[join]]]);
  expect(turns([upstream.at(-2)!, downstream[0], downstream[1]])[0]).toBeLessThan(0.2);
});

it("keeps all channel vertices inside their drainage cells and pins the water outlet", () => {
  const { map, main, branch, mouth } = network(),
    paths = createRiverPaths(map);
  for (const members of [main, branch]) {
    const allowed = new Set(members);
    for (const [x, y] of riverPath(map, paths, members).geometry.coordinates)
      expect(allowed.has(nearestTriangle(map.mesh, x, y))).toBe(true);
  }
  expect(paths.x[mouth]).toBe(map.mesh.x[mouth]);
  expect(paths.y[mouth]).toBe(map.mesh.y[mouth]);
});

it("carries finite dimensional station profiles without changing the drainage simulation", () => {
  const { map, main } = network(),
    original = structuredClone(map),
    paths = createRiverPaths(map);
  const result = riverPath(map, paths, main),
    count = result.geometry.coordinates.length;
  for (const values of Object.values(result.profiles)) {
    expect(values).toHaveLength(count);
    expect(values.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
  }
  expect(result.profiles.widths[0]).toBe(map.RiverWidth[main[0]]);
  expect(result.profiles.discharges.at(-1)).toBe(map.FlowAccumulation[main.at(-1)!]);
  expect(result.profiles.elevations.every((z, i, values) => i === 0 || z <= values[i - 1])).toBe(
    true
  );
  expect(map).toEqual(original);
});

it("retains dimensional profiles when a curved channel is clipped at a world boundary", () => {
  const { map, main } = network();
  const { geometry, profiles } = riverPath(map, createRiverPaths(map), main);
  const clipped = spatial.intersection(geometry, rectangle([0, -100_000, 100_000, 100_000]))!;
  expect(clipped).toBeTruthy();
  const count = lineParts(clipped).flat().length;
  expect(count).toBeLessThan(geometry.coordinates.length);
  for (const key of Object.keys(profiles)) {
    const values = interpolateProfile(geometry, profiles, clipped, key)!;
    expect(values).toHaveLength(count);
    expect(values.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
  }
});
