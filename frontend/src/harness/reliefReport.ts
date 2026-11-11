import {
  gridPosition,
  compactGeometryBounds,
  MapScale,
  fieldChannelName,
  requireChannel,
  type Grid,
  type World,
  type Band,
} from "@atlas/domain";
import { FieldInputCache, FieldWorkingSet } from "@atlas/storage-browser";
import { rockKindOfCode } from "../../../packages/generation/src/rock/rockCatalogue";
import type { HarnessWorkspace } from "./harnessWorkspace";
import { rockBodies } from "./reliefBodies";
import { writeReliefPictures } from "./reliefPictures";

/**
 * What a map's relief is made of, read from its saved fields without generating anything: how much
 * height differs within a few cells, which part of the ground carries that difference, whether it
 * runs in any direction, and how much each process has moved.
 */

/** How many cells count as local. */
const localCells = 3;
/** How far apart two cells of a saved map touch, in cells: sides and corners. */
const touching = 1.5;
/** Heights that together are a cell's elevation, and what each surface process has moved. */
const parts = ["Elevation", "CrustSupportElevation", "SurfaceRockLoad", "SedimentThickness"];
const moved = [
  "CumulativeFluvialErosion",
  "CumulativeGlacialErosion",
  "CumulativeCoastalErosion",
  "CumulativeDeposition",
  "CumulativeGlacialDeposition",
  "VolcanicConstructionHistory",
];
const bands = [0, 200, 500, 1000, 2000, 3000];

type Channels = Record<string, Band>;
interface Cell {
  index: number;
  x: number;
  y: number;
}
const quantile = (sorted: readonly number[], share: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] : NaN;
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    round = (value: number) => Math.round(value * 100) / 100;
  return {
    median: round(quantile(sorted, 0.5)),
    p90: round(quantile(sorted, 0.9)),
    p99: round(quantile(sorted, 0.99)),
    maximum: round(sorted[sorted.length - 1] ?? NaN),
  };
}
/** Land cells near each land cell, found through square buckets. */
function neighbours(cells: readonly Cell[], reach: number) {
  const buckets = new Map<string, Cell[]>(),
    key = (x: number, y: number) => `${Math.floor(x / reach)},${Math.floor(y / reach)}`;
  for (const cell of cells) {
    const at = key(cell.x, cell.y),
      bucket = buckets.get(at);
    if (bucket) bucket.push(cell);
    else buckets.set(at, [cell]);
  }
  return (cell: Cell) => {
    const found: Cell[] = [];
    for (let dx = -reach; dx <= reach; dx += reach)
      for (let dy = -reach; dy <= reach; dy += reach)
        for (const other of buckets.get(key(cell.x + dx, cell.y + dy)) ?? [])
          if (other !== cell && Math.hypot(other.x - cell.x, other.y - cell.y) <= reach)
            found.push(other);
    return found;
  };
}
/** How much slope around a cell lines up in one direction: 0 has no direction, 1 runs one way. */
function anisotropy(cell: Cell, near: readonly Cell[], height: (c: Cell) => number) {
  let xx = 0,
    yy = 0,
    xy = 0;
  for (const other of near) {
    const dx = other.x - cell.x,
      dy = other.y - cell.y,
      length = Math.hypot(dx, dy) || 1,
      slope = (height(other) - height(cell)) / length,
      gx = (slope * dx) / length,
      gy = (slope * dy) / length;
    xx += gx * gx;
    yy += gy * gy;
    xy += gx * gy;
  }
  const total = xx + yy;
  return total > 0 ? Math.sqrt((xx - yy) ** 2 + 4 * xy * xy) / total : 0;
}
/** The tops of the land: cells higher than everything within a few cells. */
function localTops(cells: readonly Cell[], near: (c: Cell) => Cell[], height: (c: Cell) => number) {
  return cells.filter((cell) => near(cell).every((other) => height(other) < height(cell))).length;
}
export async function loadChannels(ws: HarnessWorkspace, world: World, areaId: string) {
  const inputs = new FieldInputCache(ws.resources, ws.working.cache),
    working = new FieldWorkingSet(ws.resources, inputs.blocks, inputs),
    channels: Channels = {};
  let grid: Grid | undefined;
  for (const field of world.fields) {
    if (field.areaId !== areaId || field.input || !field.resourceId) continue;
    const resource = await ws.resources.describe(field.resourceId),
      names = Object.keys(resource.field!.channels),
      loaded = await working.load(resource.id, names, {
        id: resource.field!.geographyId,
        scope: resource.scope,
      });
    if (names.includes("Elevation")) grid = loaded;
    for (const name of names) channels[name] ??= requireChannel(loaded, fieldChannelName(name));
  }
  return { channels, grid, close: () => working.close() };
}
/** The share of land each rock kind is exposed on, most first. */
function rockShares(cells: readonly Cell[], channels: Channels) {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    const name = rockKindOfCode(channels.RockKindCodes.get(cell.index)).id;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => [name, Math.round((count / cells.length) * 1000) / 1000])
  );
}
/** Connected bodies of exposed rock on a saved map, by kind and by family. */
function savedRockBodies(cells: readonly Cell[], channels: Channels, span: number) {
  const byIndex = new Map(cells.map((cell) => [cell.index, cell])),
    near = neighbours(cells, touching * span),
    code = (i: number) => channels.RockKindCodes.get(i),
    ground = {
      count: channels.RockKindCodes.length,
      cellKm2: MapScale.areaUnits(span * span, "m2", "km2"),
      included: (i: number) => byIndex.has(i),
      around: (i: number) => near(byIndex.get(i)!).map((cell) => cell.index),
      x: (i: number) => byIndex.get(i)!.x,
      y: (i: number) => byIndex.get(i)!.y,
      deltaX: (d: number) => d,
    };
  return {
    kind: rockBodies(ground, code),
    family: rockBodies(ground, (i) => rockKindOfCode(code(i)).family),
  };
}
function reliefOf(grid: Grid, channels: Channels) {
  const span = Number(grid.scope.resolution),
    elevation = channels.Elevation,
    cells: Cell[] = [];
  for (let index = 0; index < grid.active.length; index++)
    if (
      grid.active.get(index) &&
      elevation.get(index) > (channels.EffectiveSeaLevel?.get(index) ?? 0)
    ) {
      const { x, y } = gridPosition(grid, index);
      cells.push({ index, x, y });
    }
  const near = neighbours(cells, localCells * span),
    height = (cell: Cell) =>
      MapScale.metres(
        elevation.get(cell.index) - (channels.EffectiveSeaLevel?.get(cell.index) ?? 0),
        "native"
      );
  const localRange = (name: string) =>
    summary(
      cells.map((cell) => {
        const values = [cell, ...near(cell)].map((c) => channels[name].get(c.index));
        return MapScale.metres(Math.max(...values) - Math.min(...values), "native");
      })
    );
  return {
    cellSpanKm: MapScale.inUnits(span, "km"),
    landCells: cells.length,
    localMetres: localCells * span,
    hypsometry: Object.fromEntries(
      bands.map((from, k) => [
        `${from}+`,
        cells.filter((c) => height(c) >= from && height(c) < (bands[k + 1] ?? Infinity)).length /
          cells.length,
      ])
    ),
    localRangeByPart: Object.fromEntries(
      parts.filter((name) => channels[name]).map((name) => [name, localRange(name)])
    ),
    directionality: summary(cells.map((cell) => anisotropy(cell, near(cell), height))),
    localTops: localTops(cells, near, height),
    movedByProcess: Object.fromEntries(
      moved
        .filter((name) => channels[name])
        .map((name) => [
          name,
          summary(cells.map((c) => MapScale.metres(channels[name].get(c.index), "native"))),
        ])
    ),
    rock: channels.RockResistance
      ? summary(cells.map((c) => channels.RockResistance.get(c.index) * 4000))
      : null,
    exposedRock: channels.RockKindCodes ? rockShares(cells, channels) : null,
    rockBodies: channels.RockKindCodes ? savedRockBodies(cells, channels, span) : null,
  };
}
/** The account of a map's relief, or null when it has no elevation field of its own. */
export async function reliefReport(
  ws: HarnessWorkspace,
  world: World,
  areaId: string,
  pictures: { out: string; kind: string }
) {
  const { channels, grid, close } = await loadChannels(ws, world, areaId);
  try {
    if (!grid || !channels.Elevation) return null;
    writeReliefPictures(
      grid,
      channels,
      pictures.out,
      pictures.kind,
      compactGeometryBounds(world.reference, world.areas[areaId].footprint)
    );
    return reliefOf(grid, channels);
  } finally {
    close();
  }
}
