import type { PhysicalField } from "../../../packages/generation/src/world/field";
import { MapScale } from "@atlas/domain";
import {
  layerDepth,
  rockLayers,
  watchColumn,
  type Column,
} from "../../../packages/generation/src/rock/rockColumn";
import { rockKindOfCode } from "../../../packages/generation/src/rock/rockCatalogue";

const metres = (units: number) => MapScale.metres(units, "native");
function quantiles(values: number[]) {
  values.sort((a, b) => a - b);
  const at = (q: number) => Math.round(values[Math.floor(q * (values.length - 1))] ?? 0);
  return { median: at(0.5), p90: at(0.9), p99: at(0.99) };
}
const isLand = (map: PhysicalField, i: number) =>
  map.mesh.membership(i) === 1 && map.Elevation.get(i) > map.EffectiveSeaLevel;
/** How full each land column ended, as a share of land cells by layers in use. */
function columnFill(map: PhysicalField) {
  const filled = new Array<number>(rockLayers + 1).fill(0);
  let land = 0;
  for (let i = 0; i < map.mesh.count; i++) {
    if (!isLand(map, i)) continue;
    land++;
    let used = 0;
    while (used < rockLayers && layerDepth(map, i, used) > 0) used++;
    filled[used]++;
  }
  return filled.map((cells) => Math.round((1000 * cells) / Math.max(1, land)) / 1000);
}
/**
 * What a run did to its rock columns: how much distinct rock full columns lost, how deep it lay when
 * it went, and how far stripping reached. Lost rock only matters if stripping could have reached it.
 */
export function watchRockColumns() {
  const lost = new Map<string, number>(),
    depths: number[] = [],
    stripped = new Map<number, number>(),
    remapPackages: Record<Column, Record<number, { count: number; folds: number }>> = {
      land: {},
      cut: {},
      loose: {},
      cutLoose: {},
    };
  let folds = 0,
    distinct = 0,
    thick = 0;
  const stop = watchColumn({
    fold(_cell, kind, into, thickness, above) {
      folds++;
      if (kind === into) return;
      distinct++;
      thick += metres(thickness);
      depths.push(metres(above));
      const name = rockKindOfCode(kind).id;
      lost.set(name, (lost.get(name) ?? 0) + metres(thickness));
    },
    strip(cell, amount) {
      stripped.set(cell, (stripped.get(cell) ?? 0) + metres(amount));
    },
    remapPackage(column, initial, final) {
      const bucket = (remapPackages[column][initial] ??= { count: 0, folds: 0 });
      bucket.count++;
      bucket.folds += initial - final;
    },
  });
  return (map: PhysicalField | null) => {
    stop();
    const reached: number[] = [];
    if (map)
      for (let i = 0; i < map.mesh.count; i++)
        if (isLand(map, i)) reached.push(stripped.get(i) ?? 0);
    return {
      folds,
      remapPackages,
      foldsOfDistinctRock: distinct,
      metresOfDistinctRockLost: Math.round(thick),
      lostAtDepth: quantiles(depths),
      lostByKind: Object.fromEntries(
        [...lost].sort((a, b) => b[1] - a[1]).map(([kind, m]) => [kind, Math.round(m)])
      ),
      strippedPerLandCell: quantiles(reached),
      columnFill: map ? columnFill(map) : [],
    };
  };
}
