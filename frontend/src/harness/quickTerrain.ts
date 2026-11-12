import { writeFileSync } from "node:fs";
import { MapScale } from "@atlas/domain";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { GenerationState } from "@atlas/generation";
import { physicalSampler } from "../../../packages/generation/src/world/physicalMetric";
import type { PhysicalField } from "../../../packages/generation/src/world/field";
import { mappedRiverCells } from "../../../packages/generation/src/area/riverCourses";
import { releaseHeld } from "../../../packages/generation/src/poi/poiReads";
import {
  groundwaterCapacity,
  groundwaterReturnRate,
} from "../../../packages/generation/src/water/groundwater";

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
  markedOnly: Colour = [225, 130, 200],
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
/**
 * The ground a refined map was handed by its parent, on the refined map's own cells and in
 * the same colours and contours as its own picture, so the two can be laid side by side. It
 * shows no rivers or lakes: only ground, and sea where that ground lies below the sea.
 */
function parentPicture(map: PhysicalField, heights: { get(cell: number): number }) {
  return picture(map, heights, (cell) =>
    heights.get(cell) <= map.EffectiveSeaLevel ? sea : undefined
  );
}
/** The map's ground, with a contour every hundred metres, its water and its rivers. */
function picture(
  map: PhysicalField,
  heights: { get(cell: number): number } = map.Elevation,
  waterAt: (cell: number) => Colour | undefined = (cell) => waterColour(map, cell)
) {
  const { west, south, east, north } = contentBounds(map),
    step = (east - west) / imageWidth,
    width = imageWidth,
    height = Math.ceil((north - south) / step),
    rgb = new Uint8Array(3 * width * height),
    ground = physicalSampler(map.mesh, (cell) => heights.get(cell)),
    above = (x: number, y: number) =>
      MapScale.metres(ground(x, y) - map.EffectiveSeaLevel, "native"),
    band = (metres: number) => Math.floor(metres / contourMetres);
  const colourAt = (x: number, y: number): Colour => {
    const cell = map.mesh.cellAt(x, y);
    if (cell < 0 || map.mesh.membership(cell) !== 1) return outside;
    const water = waterAt(cell);
    if (water) return water;
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
/**
 * Water on a cell. A cell on a river the map would draw is dark blue; a cell the generator
 * treats as river that no drawn river runs through is pink, so the two are told apart.
 */
function waterColour(
  map: PhysicalField,
  cell: number,
  drawn?: ReadonlySet<number>
): Colour | undefined {
  const water = map.WaterKindCodes.get(cell);
  if (water === 1) return sea;
  if (water === 2) return lake;
  // A drawn river's cell is shown whether or not the mark is on it.
  if (drawn?.has(cell)) return river;
  return map.RiverOrders.get(cell) > 0 ? markedOnly : undefined;
}
/**
 * The cells of the rivers this map would draw now: its own courses that pass its tests, with
 * rivers it has already published and its parent's rivers continuing here. What was held
 * from an earlier look is let go first, so the answer is of the present water. If the map
 * cannot say, the failure is written out and every marked cell shows as marked only.
 */
function drawnRiverCells(state: GenerationState) {
  try {
    releaseHeld(state);
    return mappedRiverCells(state);
  } catch (error) {
    process.stdout.write(`\nNo drawn rivers could be read: ${String(error)}\n`);
    return new Set<number>();
  } finally {
    releaseHeld(state);
  }
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
      heights.push(MapScale.metres(map.Elevation.get(cell) - map.EffectiveSeaLevel, "native"));
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
export function lowlandRoughness(map: PhysicalField) {
  const mesh = map.mesh,
    rough: number[] = [];
  for (let cell = 0; cell < mesh.count; cell++) {
    const height = MapScale.metres(map.Elevation.get(cell) - map.EffectiveSeaLevel, "native");
    if (mesh.membership(cell) !== 1 || map.WaterKindCodes.get(cell) !== 0 || height > lowland)
      continue;
    let most = 0;
    for (let edge = 0; edge < mesh.degree(cell); edge++) {
      const next = mesh.neighbor(cell, edge);
      if (next >= 0 && map.WaterKindCodes.get(next) === 0)
        most = Math.max(
          most,
          MapScale.metres(Math.abs(map.Elevation.get(next) - map.Elevation.get(cell)), "native")
        );
    }
    rough.push(most);
  }
  rough.sort((a, b) => a - b);
  return [0.1, 0.5, 0.9].map((q) => Math.round(rough[Math.floor(q * (rough.length - 1))]));
}
const middle = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[sorted.length >> 1] * 10) / 10 : 0;
};
/**
 * Why cells are treated as river: for those on a drawn river and those not, how many cells
 * drain through one, and what the cell itself yields a year from rain and from springs. It
 * tells a gathered river apart from ground that is marked for its own seepage or for a long
 * strip of slope above it.
 */
function riverMarkReport(map: PhysicalField, drawn?: ReadonlySet<number>) {
  const groups = { drawn: [] as number[], markedOnly: [] as number[] };
  for (let cell = 0; cell < map.mesh.count; cell++)
    if (
      map.mesh.membership(cell) === 1 &&
      map.WaterKindCodes.get(cell) === 0 &&
      map.RiverOrders.get(cell) > 0
    )
      (drawn?.has(cell) ? groups.drawn : groups.markedOnly).push(cell);
  const spring = (cell: number) =>
    MapScale.inUnits(
      groundwaterReturnRate(map.GroundwaterReturn.get(cell), map.GroundwaterInterval),
      "mm"
    );
  const describe = (cells: number[]) => ({
    cells: cells.length,
    cellsDrainingThrough: middle(
      cells.map((cell) => map.CatchmentArea.get(cell) / map.mesh.area(cell))
    ),
    fewerThanTenDrainingThrough:
      cells.filter((cell) => map.CatchmentArea.get(cell) / map.mesh.area(cell) < 10).length /
      Math.max(1, cells.length),
    ownRainRunoffMm: middle(cells.map((cell) => map.Runoff.get(cell))),
    ownSpringMm: middle(cells.map(spring)),
    monthsInFlow: middle(cells.map((cell) => map.FlowingMonths.get(cell))),
    meanFlow: middle(cells.map((cell) => map.FlowAccumulation.get(cell))),
  });
  return {
    drawn: describe(groups.drawn),
    markedOnly: describe(groups.markedOnly),
    groundwater: groundwaterReport(map, spring),
  };
}
/**
 * The land's groundwater as depths over the land, in millimetres: what falls and sinks in a
 * year, what springs are counted as giving in a year, and what the ground holds against what
 * it can hold. Springs giving more than sinks in means stored water is being counted as a
 * year's supply.
 */
function groundwaterReport(map: PhysicalField, spring: (cell: number) => number) {
  const sums = { falls: 0, sinksIn: 0, springs: 0, held: 0, canHold: 0 };
  let land = 0;
  for (let cell = 0; cell < map.mesh.count; cell++) {
    if (map.mesh.membership(cell) !== 1 || map.WaterKindCodes.get(cell) === 1) continue;
    const area = map.mesh.area(cell);
    land += area;
    sums.falls += (map.Rainfall.get(cell) + map.Snowfall.get(cell)) * area;
    sums.sinksIn += map.WaterRecharge.get(cell) * area;
    sums.springs += spring(cell) * area;
    sums.held += MapScale.inUnits(map.GroundwaterStorage.get(cell), "mm") * area;
    sums.canHold += MapScale.inUnits(groundwaterCapacity(map, cell), "mm") * area;
  }
  return {
    interval: map.GroundwaterInterval,
    ...Object.fromEntries(
      Object.entries(sums).map(([name, sum]) => [name, Math.round(land > 0 ? sum / land : 0)])
    ),
  };
}
/**
 * The valleys the ground records inside its cells, on low land: how much of a cell is valley
 * and how many metres its floor lies below the ground beside it, the median and the
 * ninetieth of cells that have one; and what share of low cells have one.
 */
function valleyReport(map: PhysicalField) {
  const shares: number[] = [],
    depths: number[] = [];
  let low = 0;
  for (let cell = 0; cell < map.mesh.count; cell++) {
    const height = MapScale.metres(map.Elevation.get(cell) - map.EffectiveSeaLevel, "native");
    if (map.mesh.membership(cell) !== 1 || map.WaterKindCodes.get(cell) !== 0 || height > lowland)
      continue;
    low++;
    if (map.GroundCutShare.get(cell) <= 0) continue;
    shares.push(map.GroundCutShare.get(cell));
    depths.push(MapScale.metres(map.GroundCutDepth.get(cell), "native"));
  }
  const at = (values: number[], q: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? Math.round(sorted[Math.floor(q * (sorted.length - 1))] * 100) / 100 : 0;
  };
  return {
    cellsWithValley: low ? shares.length / low : 0,
    share: [at(shares, 0.5), at(shares, 0.9)],
    depthMetres: [at(depths, 0.5), at(depths, 0.9)],
  };
}
export function quickTerrain(state: GenerationState, out: string, name = "terrain") {
  const map = state.physical!.map,
    handed = (state as { regional?: { inheritedHeight?: { get(cell: number): number } } }).regional
      ?.inheritedHeight;
  const drawn = drawnRiverCells(state);
  writeFileSync(
    join(out, `${name}.png`),
    picture(map, map.Elevation, (cell) => waterColour(map, cell, drawn))
  );
  if (handed) writeFileSync(join(out, "parent.png"), parentPicture(map, handed));
  const report = {
    name,
    lowlandRoughness: lowlandRoughness(map),
    ground: groundReport(map),
    lakes: lakeReport(map),
    rivers: riversAlongLakes(map),
    riverMark: riverMarkReport(map, drawn),
    valleys: valleyReport(map),
  };
  writeFileSync(join(out, `${name}.json`), JSON.stringify(report, null, 2));
  return report;
}
