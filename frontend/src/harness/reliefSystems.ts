import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PhysicalField } from "../../../packages/generation/src/world/field";
import { png } from "./quickTerrain";

/**
 * The owner's test of a world's relief: can one continent hold different kinds of mountains, young
 * and high beside old and worn, with broad plains between them? Finds each body of raised ground,
 * says what built it and how it stands, and measures the lowland interior of each landmass.
 * Observes only.
 */
const metres = 1024;
/** Ground this high counts as raised, in metres: low enough to catch old, worn ranges. */
const raisedFrom = 600;
/** A body smaller than this many cells is a hill or a cone, not a range. */
const rangeFrom = 6;
/** A young range stands at least this high; an old one has worn below it. */
const youngFrom = 2500;
/**
 * A plain is level ground, not low ground: below this height, with its neighbours within this many
 * metres of it, and this far from the sea. The Great Plains climb past a kilometre and are plains.
 */
const plainBelow = 1500,
  plainRelief = 200,
  plainInland = 150_000;

const height = (map: PhysicalField, i: number) =>
  (map.Elevation.get(i) - map.EffectiveSeaLevel) / metres;
const isLand = (map: PhysicalField, i: number) =>
  map.mesh.membership(i) === 1 && height(map, i) > 0;
function around(map: PhysicalField, i: number) {
  const found: number[] = [];
  for (let edge = 0; edge < map.mesh.degree(i); edge++) {
    const j = map.mesh.neighbor(i, edge);
    if (j >= 0 && map.mesh.membership(j) === 1) found.push(j);
  }
  return found;
}
function bodiesWhere(map: PhysicalField, keep: (i: number) => boolean) {
  const seen = new Uint8Array(map.mesh.count),
    bodies: number[][] = [];
  for (let start = 0; start < map.mesh.count; start++) {
    if (seen[start] || !keep(start)) continue;
    const stack = [start],
      cells: number[] = [];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      for (const j of around(map, i))
        if (!seen[j] && keep(j)) {
          seen[j] = 1;
          stack.push(j);
        }
    }
    bodies.push(cells);
  }
  return bodies;
}
/** What a range is: built by a belt working now, or left by one that has stopped. */
function describeRange(map: PhysicalField, cells: readonly number[]) {
  const heights = cells.map((i) => height(map, i)),
    share = (test: (i: number) => boolean) => cells.filter(test).length / cells.length,
    highest = Math.max(...heights),
    active = share((i) => map.OrogenicConstruction.get(i) > 0),
    sheeted = share((i) => map.ThrustSheetIndex.get(i) > 0),
    sutured = share((i) => map.CrustSutureStrength.get(i) > 100),
    volcanic = share((i) => map.VolcanicConstructionHistory.get(i) > 100 * metres);
  return {
    cells: cells.length,
    mean: Math.round(heights.reduce((sum, h) => sum + h, 0) / cells.length),
    highest: Math.round(highest),
    active: +active.toFixed(2),
    sheeted: +sheeted.toFixed(2),
    sutured: +sutured.toFixed(2),
    volcanic: +volcanic.toFixed(2),
    kind: rangeKind(highest, active, sheeted + sutured),
    ...rangeWidth(map, cells),
    landmass: map.LandmassIds.get(cells[0]),
  };
}
function rangeKind(highest: number, active: number, structure: number) {
  if (highest >= youngFrom && active >= 0.2) return "young";
  if (highest < youngFrom && active < 0.2 && structure >= 0.2) return "old";
  return highest >= youngFrom ? "high, belt quiet" : "low, no structure or still active";
}
function plainsOf(map: PhysicalField) {
  return bodiesWhere(
    map,
    (i) =>
      isLand(map, i) &&
      height(map, i) < plainBelow &&
      map.OceanDistance.get(i) >= plainInland &&
      around(map, i).every((j) => Math.abs(height(map, j) - height(map, i)) <= plainRelief)
  );
}
/** Whether high ground crowds a bounded map's edge: its share there beside the land's own share. */
export function highGroundAtEdge(map: PhysicalField, reach = 300_000, high = 2000) {
  const [west, south, east, north] = map.mesh.bounds,
    [originX, originY] = map.mesh.origin,
    atEdge = (i: number) => {
      const x = map.mesh.x(i) + originX,
        y = map.mesh.y(i) + originY;
      return Math.min(x - west, east - x, y - south, north - y) < reach;
    };
  let land = 0,
    landEdge = 0,
    raised = 0,
    raisedEdge = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isLand(map, i)) continue;
    land++;
    if (atEdge(i)) landEdge++;
    if (height(map, i) < high) continue;
    raised++;
    if (atEdge(i)) raisedEdge++;
  }
  return {
    landNearEdge: +(landEdge / Math.max(1, land)).toFixed(2),
    highGroundNearEdge: +(raisedEdge / Math.max(1, raised)).toFixed(2),
  };
}
/** How far from the sea a landmass's land gets, in kilometres. */
function deepestInland(map: PhysicalField, id: number) {
  let deepest = 0;
  for (let i = 0; i < map.mesh.count; i++)
    if (isLand(map, i) && map.LandmassIds.get(i) === id)
      deepest = Math.max(deepest, map.OceanDistance.get(i));
  return Math.round(deepest / 1000);
}
/** How wide the land above each height runs, across the long way of each connected body of it. */
export function widthsAbove(map: PhysicalField, thresholds = [1000, 2000, 3000, 4000]) {
  const span = Math.sqrt(map.mesh.area(map.mesh.cellAt(0, 0))) / 1000;
  return {
    cellKm: Math.round(span),
    bands: thresholds.map((from) => {
      const bodies = bodiesWhere(map, (i) => isLand(map, i) && height(map, i) >= from),
        sized = bodies
          .filter((cells) => cells.length >= 3)
          .map((cells) => ({ cells: cells.length, ...rangeWidth(map, cells) }))
          .sort((a, b) => b.cells - a.cells);
      return {
        from,
        cells: bodies.reduce((sum, cells) => sum + cells.length, 0),
        bodies: bodies.length,
        singleCells: bodies.filter((cells) => cells.length === 1).length,
        largest: sized.slice(0, 4),
      };
    }),
  };
}
/** Each landmass's ranges and plains: the kinds of mountain it holds and the room between them. */
export function mountainSystems(map: PhysicalField) {
  const ranges = bodiesWhere(map, (i) => isLand(map, i) && height(map, i) >= raisedFrom)
      .filter((cells) => cells.length >= rangeFrom)
      .map((cells) => describeRange(map, cells)),
    plains = plainsOf(map),
    landmasses = new Map<number, number>(),
    cellKm2 = (map.mesh.spacing * map.mesh.spacing * 0.433) / 1e6;
  for (let i = 0; i < map.mesh.count; i++)
    if (isLand(map, i))
      landmasses.set(map.LandmassIds.get(i), (landmasses.get(map.LandmassIds.get(i)) ?? 0) + 1);
  return [...landmasses]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id, cells]) => {
      const own = ranges.filter((range) => range.landmass === id),
        kinds = own.reduce<Record<string, number>>(
          (held, range) => ({ ...held, [range.kind]: (held[range.kind] ?? 0) + 1 }),
          {}
        ),
        inland = plains
          .filter((body) => map.LandmassIds.get(body[0]) === id)
          .map((body) => body.length);
      return {
        landmass: id,
        cells,
        deepestInlandKm: deepestInland(map, id),
        kinds,
        widestPlainKm2: Math.round(Math.max(0, ...inland) * cellKm2),
        plainShare: +(inland.reduce((sum, n) => sum + n, 0) / cells).toFixed(2),
        ranges: own.sort((a, b) => b.cells - a.cells).slice(0, 5),
      };
    });
}
const kindColour: Record<string, [number, number, number]> = {
  young: [220, 60, 50],
  old: [60, 120, 220],
  "high, belt quiet": [230, 170, 40],
  "low, no structure or still active": [150, 150, 150],
};
function colourOfLand(map: PhysicalField) {
  const colours = new Map<number, [number, number, number]>();
  for (const cells of bodiesWhere(map, (i) => isLand(map, i) && height(map, i) >= raisedFrom)) {
    if (cells.length < rangeFrom) continue;
    const colour = kindColour[describeRange(map, cells).kind];
    for (const i of cells) colours.set(i, colour);
  }
  for (const body of plainsOf(map)) for (const i of body) colours.set(i, [190, 225, 170]);
  return colours;
}
/** How steep the land is between neighbouring cells, in metres of height per kilometre. */
export function landSlopes(map: PhysicalField) {
  const slopes: number[] = [];
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isLand(map, i)) continue;
    let steepest = 0;
    for (const j of around(map, i)) {
      const run = map.mesh.spacing / 1000;
      steepest = Math.max(steepest, Math.abs(height(map, i) - height(map, j)) / run);
    }
    slopes.push(steepest);
  }
  slopes.sort((a, b) => a - b);
  const at = (share: number) => +(slopes[Math.floor(share * (slopes.length - 1))] ?? 0).toFixed(1);
  return { median: at(0.5), p90: at(0.9), p99: at(0.99), steepest: at(1) };
}
/** How wide a range is across its long axis, in kilometres: its area over its length. */
function rangeWidth(map: PhysicalField, cells: readonly number[]) {
  const xs = cells.map((i) => map.mesh.x(i)),
    ys = cells.map((i) => map.mesh.y(i)),
    mx = xs.reduce((sum, v) => sum + v, 0) / cells.length,
    my = ys.reduce((sum, v) => sum + v, 0) / cells.length;
  let xx = 0,
    yy = 0,
    xy = 0;
  cells.forEach((_, n) => {
    xx += (xs[n] - mx) ** 2;
    yy += (ys[n] - my) ** 2;
    xy += (xs[n] - mx) * (ys[n] - my);
  });
  const spread = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy),
    long = Math.sqrt((xx + yy + spread) / 2 / cells.length) * 3.46,
    area = cells.reduce((sum, i) => sum + map.mesh.area(i), 0);
  return {
    lengthKm: Math.round(long / 1000),
    widthKm: Math.round(area / Math.max(1, long) / 1000),
  };
}
const heightColours: readonly (readonly [number, readonly [number, number, number]])[] = [
  [200, [90, 150, 90]],
  [500, [150, 185, 110]],
  [1000, [215, 205, 120]],
  [2000, [215, 150, 70]],
  [3000, [180, 80, 50]],
  [4000, [110, 50, 40]],
  [Infinity, [245, 245, 245]],
];
/** Land by height, in bands, with active convergent boundaries black. */
export function drawHeights(map: PhysicalField, out: string, name: string, contacts = true) {
  drawCells(map, out, name, (i) => {
    if (contacts && map.TectonicBoundaryCodes.get(i) === 1) return [0, 0, 0];
    if (!isLand(map, i)) return [35, 45, 70];
    return heightColours.find(([below]) => height(map, i) < below)![1];
  });
}
/** Land by what it is: each range by kind, plains pale green, other land grey-green, sea dark. */
export function drawSystems(map: PhysicalField, out: string, name: string) {
  const colours = colourOfLand(map);
  drawCells(map, out, name, (i) =>
    isLand(map, i) ? (colours.get(i) ?? [120, 140, 110]) : [35, 45, 70]
  );
}
function drawCells(
  map: PhysicalField,
  out: string,
  name: string,
  colourAt: (i: number) => readonly number[]
) {
  const [west, south, east, north] = map.mesh.bounds,
    [originX, originY] = map.mesh.origin,
    width = 900,
    tall = Math.ceil((width * (north - south)) / (east - west)),
    span = (east - west) / width,
    rgb = new Uint8Array(3 * width * tall);
  for (let row = 0; row < tall; row++)
    for (let col = 0; col < width; col++) {
      const i = map.mesh.cellAt(
          west - originX + (col + 0.5) * span,
          north - originY - (row + 0.5) * span
        ),
        colour = i < 0 ? [35, 45, 70] : colourAt(i);
      rgb.set(colour, 3 * (row * width + col));
    }
  writeFileSync(join(out, name), png(width, tall, rgb));
}
