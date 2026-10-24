import { expect, it } from "vitest";
import { createGrid, fieldInterpolator, rectangle, type SpatialScope } from "@atlas/domain";
import { atlasPhysicalProfile } from "./atlasProfile";
import { createField, type PhysicalField } from "./field";
import { units } from "./math";
import { createWorldMesh } from "./worldMesh";
import { nativePosition } from "./atlasWorkspace";
import { synthesizeRelief } from "./adaptiveRelief";

const size = 300_000;
const footprint = rectangle([0, 0, size, size]);
const scope = {
  worldId: "w",
  areaId: "a",
  spaceId: "s",
  footprint,
  crsId: "c",
  revision: 0,
  time: "present",
  resolution: null,
} as unknown as SpatialScope;

// A parent at 30 km cells: a flat lowland west of the middle, a steep ramp east of it.
function parentGrid() {
  const grid = createGrid("parent", scope, 11, 11);
  const values = new Float64Array(grid.width * grid.height);
  for (let index = 0; index < values.length; index++) {
    const x = (size * (index % grid.width)) / (grid.width - 1);
    values[index] = x < size / 2 ? 100 + x * 0.0005 : 200 + (x - size / 2) * 0.02;
  }
  grid.channels.elevation = values;
  grid.units.elevation = "metre";
  return grid;
}
const at = (map: PhysicalField, i: number) => nativePosition({ map } as never, i);
function inheritedChild(parent: ReturnType<typeof parentGrid>) {
  const map = createField(createWorldMesh([0, 0, size, size], 4096, 0));
  const elevationAt = fieldInterpolator(parent, "elevation");
  for (let i = 0; i < map.mesh.count; i++)
    map.Elevation[i] = map.BedrockElevation[i] = units(elevationAt(at(map, i)));
  map.RockResistance.fill(1000);
  return map;
}
/** Worst absolute area-weighted mean change over the parent's cells. */
function worstParentMean(map: PhysicalField, change: (i: number) => number, cells: number[]) {
  const means = new Map<number, { sum: number; weight: number }>();
  for (const i of cells) {
    const { x, y } = at(map, i);
    const key = Math.round((y / size) * 10) * 11 + Math.round((x / size) * 10);
    const entry = means.get(key) ?? { sum: 0, weight: 0 };
    entry.sum += change(i) * map.mesh.areas[i];
    entry.weight += map.mesh.areas[i];
    means.set(key, entry);
  }
  let worst = 0;
  for (const { sum, weight } of means.values()) worst = Math.max(worst, Math.abs(sum / weight));
  return worst;
}
/** Mean |cos| between the change's gradient and the x axis (the parent gradient direction). */
function alignment(map: PhysicalField, change: (i: number) => number, cells: number[]) {
  const mesh = map.mesh;
  let cos = 0,
    n = 0;
  for (const i of cells) {
    const p = at(map, i);
    let dx = 0,
      dy = 0;
    for (let e = 0; e < mesh.degree[i]; e++) {
      const j = mesh.neighbors[i * mesh.stride + e];
      if (j < 0) continue;
      const q = at(map, j),
        len = Math.hypot(q.x - p.x, q.y - p.y);
      dx += ((change(j) - change(i)) / len) * ((q.x - p.x) / len);
      dy += ((change(j) - change(i)) / len) * ((q.y - p.y) / len);
    }
    const g = Math.hypot(dx, dy);
    if (g === 0) continue;
    cos += Math.abs(dx / g);
    n++;
  }
  return cos / n;
}

it("adds ridge-and-valley relief where the parent is steep, leaves lowland and the band alone, and conserves parent-cell means", () => {
  const parent = parentGrid(),
    map = inheritedChild(parent),
    mesh = map.mesh;
  const before = Float64Array.from(map.Elevation);
  const band = mesh.spacing * 2;
  const result = synthesizeRelief(map, parent, footprint, band, 7, atlasPhysicalProfile());
  expect(result.changed).toBeGreaterThan(100);

  const change = (i: number) => (map.Elevation[i] - before[i]) / 1024;
  const inBand = (i: number) => {
    const { x, y } = at(map, i);
    return Math.min(x, size - x, y, size - y) < band;
  };
  const rms = (members: number[]) =>
    Math.sqrt(members.reduce((s, i) => s + change(i) ** 2, 0) / Math.max(1, members.length));
  const cells = Array.from({ length: mesh.count }, (_, i) => i).filter(
    (i) => mesh.contentAreas[i] > 0 && !inBand(i)
  );
  const steep = cells.filter((i) => at(map, i).x > size * 0.6 && at(map, i).x < size * 0.9),
    gentle = cells.filter((i) => at(map, i).x > size * 0.1 && at(map, i).x < size * 0.4);
  // The ramp has 600 m of relief per parent cell; the fractal noise carries about a sixth of
  // its amplitude as RMS, so the texture is a few hundred metres peak to peak and well above
  // the lowland, which stays untouched below the floor.
  expect(rms(steep)).toBeGreaterThan(120);
  expect(Math.max(...steep.map((i) => Math.abs(change(i))))).toBeGreaterThan(400);
  expect(rms(gentle)).toBeLessThan(30);
  for (let i = 0; i < mesh.count; i++) if (inBand(i)) expect(change(i)).toBe(0);
  // Each parent cell keeps its mean height: the child only redistributes within it.
  expect(worstParentMean(map, change, cells)).toBeLessThan(10);
  // Bedrock carries the relief and the surface stays consistent.
  for (const i of cells)
    expect(map.Elevation[i]).toBe(map.BedrockElevation[i] + map.SedimentThickness[i]);
  // Ridges run along the belt: the added relief changes mostly across the parent gradient (x),
  // well above the 2/π ≈ 0.64 an isotropic texture gives.
  expect(alignment(map, change, steep)).toBeGreaterThan(0.75);
});
