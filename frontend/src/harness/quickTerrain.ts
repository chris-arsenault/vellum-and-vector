import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { GenerationState } from "@atlas/generation";
import { physicalSampler } from "../../../packages/generation/src/world/physicalMetric";
import type { PhysicalField } from "../../../packages/generation/src/world/field";

/**
 * A look at a refined map's ground the moment its water is settled, from the field itself. It
 * reads the terrain before anything is published, which is what makes it quick.
 */
const imageWidth = 1000,
  contourMetres = 100,
  flat = 0.005,
  gentle = 0.02,
  steep = 0.1,
  lowland = 300;
type Colour = [number, number, number];
const sea: Colour = [176, 208, 216],
  lake: Colour = [120, 180, 220],
  river: Colour = [40, 90, 170],
  contour: Colour = [120, 100, 70],
  outside: Colour = [255, 255, 255];
const hypsometric: [number, Colour][] = [
  [0, [190, 214, 150]],
  [300, [214, 220, 165]],
  [800, [205, 190, 145]],
  [1600, [175, 150, 120]],
  [3000, [230, 230, 228]],
];

function chunk(type: string, data: Buffer) {
  const head = Buffer.from(type, "latin1"),
    size = Buffer.alloc(4),
    check = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  check.writeUInt32BE(crc32(Buffer.concat([head, data])) >>> 0);
  return Buffer.concat([size, head, data, check]);
}
export function png(width: number, height: number, rgb: Uint8Array) {
  const head = Buffer.alloc(13),
    raw = Buffer.alloc((3 * width + 1) * height);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 2, 0, 0, 0], 8);
  for (let y = 0; y < height; y++)
    raw.set(rgb.subarray(3 * width * y, 3 * width * (y + 1)), (3 * width + 1) * y + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function groundColour(height: number): Colour {
  let at = 0;
  while (at < hypsometric.length - 2 && height > hypsometric[at + 1][0]) at++;
  const [low, a] = hypsometric[at],
    [high, b] = hypsometric[at + 1],
    t = Math.max(0, Math.min(1, (height - low) / (high - low)));
  return [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t) as Colour;
}
function contentBounds(map: PhysicalField) {
  const mesh = map.mesh;
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let cell = 0; cell < mesh.count; cell++) {
    if (mesh.membership(cell) !== 1) continue;
    west = Math.min(west, mesh.x(cell));
    east = Math.max(east, mesh.x(cell));
    south = Math.min(south, mesh.y(cell));
    north = Math.max(north, mesh.y(cell));
  }
  return { west, south, east, north };
}
/** The map's ground, with a contour every hundred metres, its water and its rivers. */
function picture(map: PhysicalField) {
  const { west, south, east, north } = contentBounds(map),
    step = (east - west) / imageWidth,
    width = imageWidth,
    height = Math.ceil((north - south) / step),
    rgb = new Uint8Array(3 * width * height),
    ground = physicalSampler(map.mesh, map.Elevation),
    above = (x: number, y: number) => (ground(x, y) - map.EffectiveSeaLevel) / 1024,
    band = (metres: number) => Math.floor(metres / contourMetres);
  const colourAt = (x: number, y: number): Colour => {
    const cell = map.mesh.cellAt(x, y);
    if (cell < 0 || map.mesh.membership(cell) !== 1) return outside;
    const water = map.WaterKindCodes.get(cell);
    if (water === 1) return sea;
    if (water === 2) return lake;
    if (map.RiverOrders.get(cell) > 0) return river;
    const here = above(x, y);
    return band(here) !== band(above(x + step, y)) || band(here) !== band(above(x, y + step))
      ? contour
      : groundColour(here);
  };
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++)
      rgb.set(colourAt(west + col * step, north - row * step), 3 * (width * row + col));
  return png(width, height, rgb);
}
const shareBelow = (sorted: number[], limit: number) =>
  sorted.length ? sorted.filter((value) => value < limit).length / sorted.length : 0;
function groundReport(map: PhysicalField) {
  const mesh = map.mesh,
    slopes: number[] = [],
    heights: number[] = [];
  for (let cell = 0; cell < mesh.count; cell++)
    if (mesh.membership(cell) === 1 && map.WaterKindCodes.get(cell) === 0) {
      slopes.push(map.Slope.get(cell));
      heights.push((map.Elevation.get(cell) - map.EffectiveSeaLevel) / 1024);
    }
  slopes.sort((a, b) => a - b);
  heights.sort((a, b) => a - b);
  const at = (sorted: number[], q: number) => sorted[Math.floor(q * (sorted.length - 1))];
  return {
    landCells: slopes.length,
    flatShare: shareBelow(slopes, flat),
    gentleShare: shareBelow(slopes, gentle),
    steepShare: 1 - shareBelow(slopes, steep),
    slope: [0.1, 0.5, 0.9].map((q) => at(slopes, q)),
    height: [0.1, 0.5, 0.9, 1].map((q) => Math.round(at(heights, q))),
  };
}
/** How round each lake is: its area over the circle reaching its farthest shore. */
function lakeReport(map: PhysicalField) {
  const mesh = map.mesh,
    bodies = new Map<number, number[]>();
  for (let cell = 0; cell < mesh.count; cell++)
    if (mesh.membership(cell) === 1 && map.WaterKindCodes.get(cell) === 2) {
      const body = map.WaterBodyIds.get(cell);
      bodies.set(body, [...(bodies.get(body) ?? []), cell]);
    }
  const roundness = [...bodies.values()].map((cells) => {
    const x = cells.reduce((sum, c) => sum + mesh.x(c), 0) / cells.length,
      y = cells.reduce((sum, c) => sum + mesh.y(c), 0) / cells.length,
      far = cells.reduce((most, c) => Math.max(most, Math.hypot(mesh.x(c) - x, mesh.y(c) - y)), 0),
      area = cells.reduce((sum, c) => sum + mesh.contentArea(c), 0);
    return far > 0 ? area / (Math.PI * far * far) : 1;
  });
  roundness.sort((a, b) => a - b);
  return {
    lakes: bodies.size,
    largestCells: Math.max(0, ...[...bodies.values()].map((cells) => cells.length)),
    medianRoundness: roundness[roundness.length >> 1] ?? 0,
  };
}
/** River cells beside a lake that run on past it instead of into it. */
function riversAlongLakes(map: PhysicalField) {
  const mesh = map.mesh,
    isLake = (cell: number) => cell >= 0 && map.WaterKindCodes.get(cell) === 2;
  let rivers = 0,
    along = 0;
  for (let cell = 0; cell < mesh.count; cell++) {
    if (mesh.membership(cell) !== 1 || map.RiverOrders.get(cell) <= 0) continue;
    rivers++;
    let beside = false;
    for (let edge = 0; edge < mesh.degree(cell); edge++)
      beside ||= isLake(mesh.neighbor(cell, edge));
    if (beside && !isLake(map.FlowTargets.get(cell))) along++;
  }
  return { rivers, along };
}
/** Metres between a low cell and its neighbours, the tenth, median and ninetieth: how rough plains are. */
function lowlandRoughness(map: PhysicalField) {
  const mesh = map.mesh,
    rough: number[] = [];
  for (let cell = 0; cell < mesh.count; cell++) {
    const height = (map.Elevation.get(cell) - map.EffectiveSeaLevel) / 1024;
    if (mesh.membership(cell) !== 1 || map.WaterKindCodes.get(cell) !== 0 || height > lowland)
      continue;
    let most = 0;
    for (let edge = 0; edge < mesh.degree(cell); edge++) {
      const next = mesh.neighbor(cell, edge);
      if (next >= 0 && map.WaterKindCodes.get(next) === 0)
        most = Math.max(most, Math.abs(map.Elevation.get(next) - map.Elevation.get(cell)) / 1024);
    }
    rough.push(most);
  }
  rough.sort((a, b) => a - b);
  return [0.1, 0.5, 0.9].map((q) => Math.round(rough[Math.floor(q * (rough.length - 1))]));
}
export function quickTerrain(state: GenerationState, out: string, name = "terrain") {
  const map = state.physical!.map;
  writeFileSync(join(out, `${name}.png`), picture(map));
  const report = {
    name,
    lowlandRoughness: lowlandRoughness(map),
    ground: groundReport(map),
    lakes: lakeReport(map),
    rivers: riversAlongLakes(map),
  };
  writeFileSync(join(out, `${name}.json`), JSON.stringify(report, null, 2));
  return report;
}
