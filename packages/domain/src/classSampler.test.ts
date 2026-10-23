import { expect, it } from "vitest";
import { classInterpolator } from "./classSampler";
import { createAdaptiveField } from "./adaptiveField";
import { adaptiveGeometry, createAdaptiveTopology } from "./adaptiveTopology";
import { adaptivePointSampler } from "./adaptivePoint";
import { createGrid, putChannel } from "./grids";
import { rectangle } from "./spatial";

const scope = {
  worldId: "world",
  areaId: "area",
  spaceId: "surface",
  crsId: "metres",
  footprint: rectangle([0, 0, 1000, 1000]),
  time: "present",
  revision: 1,
  resolution: null,
};
function classes(bounds: [number, number, number, number], size: number) {
  const topology = createAdaptiveTopology(bounds, { maximumSize: size, minimumSize: size });
  const field = createAdaptiveField("classes", scope, topology);
  const geometry = adaptiveGeometry(topology);
  // A diagonal boundary between two classes, plus one island cell of a third.
  putChannel(
    field,
    "finalSurface",
    "category",
    Float64Array.from(geometry.x, (x, i) => {
      if (Math.abs(x - 125) < 1 && Math.abs(geometry.y[i] - 875) < 1) return 102;
      return x + geometry.y[i] < 1001 ? 3 : 28;
    })
  );
  return { field, topology, geometry };
}

it("keeps stored classes at cell centres and never invents intermediate codes", () => {
  const { field, geometry } = classes([0, 0, 1000, 1000], 250);
  const at = classInterpolator(field, "finalSurface");
  geometry.x.forEach((x, i) =>
    expect(at({ x, y: geometry.y[i], z: 0 })).toBe(field.channels.finalSurface[i])
  );
  const seen = new Set<number>();
  for (let y = 5; y < 1000; y += 10)
    for (let x = 5; x < 1000; x += 10) seen.add(at({ x, y, z: 0 }));
  expect([...seen].sort((a, b) => a - b)).toEqual([3, 28, 102]);
});
it("places the class boundary where interpolated membership crosses one half", () => {
  const { field, topology } = classes([0, 0, 1000, 1000], 250);
  const at = classInterpolator(field, "finalSurface");
  const share = (code: number) =>
    adaptivePointSampler(topology, (leaf) => Number(field.channels.finalSurface[leaf] === code));
  const upper = share(28),
    lower = share(3),
    island = share(102);
  let agreements = 0,
    boundary = 0;
  // Touching regions are outlined where one membership overtakes the other, the rule
  // `labelContour` uses for region polygons; the raster class must switch there too.
  for (let y = 5; y < 1000; y += 10)
    for (let x = 5; x < 1000; x += 10) {
      const lead = upper(x, y) - lower(x, y);
      if (Math.abs(lead) < 0.02 || island(x, y) > 0.05) continue;
      boundary++;
      if ((at({ x, y, z: 0 }) === 28) === lead > 0) agreements++;
    }
  expect(boundary).toBeGreaterThan(3000);
  expect(agreements).toBe(boundary);
  // Three cells of one class meet one of the other at (500, 500): the corner rounds
  // into the lone cell instead of the staircase a nearest-cell lookup would draw.
  expect(at({ x: 505, y: 505, z: 0 })).toBe(3);
  expect(at({ x: 600, y: 600, z: 0 })).toBe(28);
});
it("blends classes over a regular grid's bilinear support and rounds corners", () => {
  const grid = createGrid("plain", { ...scope, resolution: 250 }, 4, 4);
  // Columns 0-1 are class 3 and columns 2-3 class 28, except one lone 28 cell at (1, 1).
  putChannel(
    grid,
    "finalSurface",
    "category",
    Float64Array.from({ length: 16 }, (_, i) => (i % 4 < 2 && i !== 5 ? 3 : 28))
  );
  const at = classInterpolator(grid, "finalSurface");
  expect(at({ x: 100, y: 800, z: 0 })).toBe(3);
  expect(at({ x: 900, y: 800, z: 0 })).toBe(28);
  // Sample columns sit at x = 0, 333, 667, 1000; the boundary falls midway between them.
  expect(at({ x: 480, y: 800, z: 0 })).toBe(3);
  expect(at({ x: 520, y: 800, z: 0 })).toBe(28);
  // The lone cell at (333, 333) keeps its class at its sample but loses the corners
  // of the square a nearest-cell lookup would paint around it.
  expect(at({ x: 333, y: 333, z: 0 })).toBe(28);
  expect(at({ x: 200, y: 200, z: 0 })).toBe(3);
  const seen = new Set<number>();
  for (let y = 0; y <= 1000; y += 25)
    for (let x = 0; x <= 1000; x += 25) seen.add(at({ x, y, z: 0 }));
  expect([...seen].sort((a, b) => a - b)).toEqual([3, 28]);
});
