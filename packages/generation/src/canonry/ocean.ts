// OceanConnectivityLayer.cs, Canonry 0f62584c.
import { setWaterSurface, type PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { noWaterSurface, units } from "./math";

class OceanComponents {
  readonly parent: Int32Array;
  readonly sizes: Int32Array;
  readonly contents: Float64Array;
  readonly boundary: Uint8Array;
  connected = 0;
  constructor(private readonly map: PhysicalField) {
    const n = map.mesh.count;
    this.parent = new Int32Array(n).fill(-1);
    this.sizes = new Int32Array(n);
    this.contents = new Float64Array(n);
    this.boundary = new Uint8Array(n);
  }
  activate(i: number) {
    this.parent[i] = i;
    this.sizes[i] = 1;
    this.contents[i] = this.map.mesh.contentAreas[i];
    this.boundary[i] = this.map.mesh.boundary[i];
    if (this.boundary[i]) this.connected += this.contents[i];
  }
  root(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[i] !== i) {
      const next = this.parent[i];
      this.parent[i] = root;
      i = next;
    }
    return root;
  }
  union(first: number, second: number) {
    let a = this.root(first),
      b = this.root(second);
    if (a === b) return;
    if (this.sizes[a] < this.sizes[b]) [a, b] = [b, a];
    if (this.boundary[a]) this.connected -= this.contents[a];
    if (this.boundary[b]) this.connected -= this.contents[b];
    this.parent[b] = a;
    this.sizes[a] += this.sizes[b];
    this.contents[a] += this.contents[b];
    this.boundary[a] |= this.boundary[b];
    if (this.boundary[a]) this.connected += this.contents[a];
  }
}
function connectedOceanLevel(map: PhysicalField, target: number): number {
  const order = Array.from({ length: map.mesh.count }, (_, i) => i).sort(
    (a, b) => map.Elevation[b] - map.Elevation[a] || a - b
  );
  const components = new OceanComponents(map);
  let cursor = order.length - 1,
    elevation = map.Elevation[order[0]];
  while (cursor >= 0) {
    elevation = map.Elevation[order[cursor]];
    const end = cursor;
    while (cursor >= 0 && map.Elevation[order[cursor]] === elevation)
      components.activate(order[cursor--]);
    for (let index = end; index > cursor; index--) {
      const i = order[index];
      for (let edge = 0; edge < map.mesh.degree[i]; edge++) {
        const j = map.mesh.neighbors[i * map.mesh.stride + edge];
        if (j >= 0 && components.parent[j] >= 0) components.union(i, j);
      }
    }
    if (components.connected >= target) break;
  }
  return elevation + units(1);
}
/** Volume (m³) of the ocean connected to the boundary when the water stands at `level`. */
function connectedVolume(map: PhysicalField, level: number): number {
  const seen = new Uint8Array(map.mesh.count),
    queue: number[] = [];
  let volume = 0;
  const visit = (i: number) => {
    if (i < 0 || seen[i] || map.Elevation[i] >= level) return;
    seen[i] = 1;
    volume += ((level - map.Elevation[i]) / 1024) * map.mesh.contentAreas[i];
    queue.push(i);
  };
  for (let i = 0; i < map.mesh.count; i++) if (map.mesh.boundary[i]) visit(i);
  for (let head = 0; head < queue.length; head++)
    for (let edge = 0; edge < map.mesh.degree[queue[head]]; edge++)
      visit(map.mesh.neighbors[queue[head] * map.mesh.stride + edge]);
  return volume;
}
/** The level at which the connected ocean holds `volume`: the water budget sets the datum. */
function levelForVolume(map: PhysicalField, volume: number): number {
  let low = Infinity,
    high = -Infinity;
  for (let i = 0; i < map.mesh.count; i++) {
    low = Math.min(low, map.Elevation[i]);
    high = Math.max(high, map.Elevation[i]);
  }
  high += units(1);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (connectedVolume(map, middle) < volume) low = middle;
    else high = middle;
  }
  return high;
}
function lowestBoundary(map: PhysicalField) {
  let boundary = Number.MAX_VALUE;
  for (let i = 0; i < map.mesh.count; i++)
    if (map.mesh.boundary[i]) boundary = Math.min(boundary, map.Elevation[i]);
  return boundary;
}
/**
 * Formation chooses the water budget: each formation flood sets the level that covers the
 * target share of the content area, so margins and shelves built during formation are part of
 * the planet the budget is measured on. Every epoch flood keeps that volume, so land that sinks
 * or rises moves the sea instead of being quietly drowned or stranded, and an epoch's eustatic
 * offset applies on top. A datum inherited from a parent (no recorded volume) is never moved.
 */
function seaLevel(map: PhysicalField, c: PhysicalContext) {
  const owned = !map.SeaLevelInitialized || map.BaseOceanVolume > 0;
  if (owned && !c.IsEvolutionEpoch) {
    const area = map.mesh.contentAreas.reduce((sum, value) => sum + value, 0);
    const target = area * c.Profile.QualityTargets.OceanCoverage.target;
    map.BaseSeaLevel = Math.max(
      connectedOceanLevel(map, target) + units(c.Profile.SeaLevel * c.Profile.ElevationScale),
      lowestBoundary(map) + units(1)
    );
    map.BaseOceanVolume = connectedVolume(map, map.BaseSeaLevel);
    map.SeaLevelInitialized = true;
  } else if (map.BaseOceanVolume > 0) {
    map.BaseSeaLevel = Math.max(
      levelForVolume(map, map.BaseOceanVolume),
      lowestBoundary(map) + units(1)
    );
  }
  return map.BaseSeaLevel + units(c.SeaLevelOffset);
}
export function oceanConnectivity(map: PhysicalField, c: PhysicalContext) {
  map.WaterKindCodes.fill(0);
  map.WaterBodyIds.fill(0);
  map.WaterDepths.fill(0);
  map.WaterSurfaceElevations.fill(noWaterSurface);
  map.EffectiveSeaLevel = seaLevel(map, c);
  const queue: number[] = [];
  const mark = (i: number) => {
    if (i < 0 || map.WaterKindCodes[i] !== 0 || map.Elevation[i] >= map.EffectiveSeaLevel) return;
    map.WaterKindCodes[i] = 1;
    map.WaterBodyIds[i] = 1;
    setWaterSurface(map, i, map.EffectiveSeaLevel);
    queue.push(i);
  };
  for (let i = 0; i < map.mesh.count; i++) if (map.mesh.boundary[i]) mark(i);
  for (let head = 0; head < queue.length; head++)
    for (let edge = 0; edge < map.mesh.degree[queue[head]]; edge++)
      mark(map.mesh.neighbors[queue[head] * map.mesh.stride + edge]);
}
