// OceanConnectivityLayer.cs, Canonry 0f62584c.
import { setWaterSurface, type PhysicalField } from "./field";
import type { PhysicalContext } from "./context";
import { noWaterSurface, round, units } from "./math";

class OceanComponents {
  readonly parent: Int32Array;
  readonly sizes: Int32Array;
  readonly contents: Int32Array;
  readonly boundary: Uint8Array;
  connected = 0;
  constructor(private readonly map: PhysicalField) {
    const n = map.mesh.count;
    this.parent = new Int32Array(n).fill(-1);
    this.sizes = new Int32Array(n);
    this.contents = new Int32Array(n);
    this.boundary = new Uint8Array(n);
  }
  activate(i: number) {
    this.parent[i] = i;
    this.sizes[i] = 1;
    this.contents[i] = i < this.map.mesh.contentCount ? 1 : 0;
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
      for (let edge = 0; edge < 3; edge++) {
        const j = map.mesh.neighbors[i * 3 + edge];
        if (j >= 0 && components.parent[j] >= 0) components.union(i, j);
      }
    }
    if (components.connected >= target) break;
  }
  return elevation + units(1);
}
function seaLevel(map: PhysicalField, c: PhysicalContext) {
  if (!map.SeaLevelInitialized) {
    const target = Math.max(
      1,
      Math.min(
        map.mesh.contentCount,
        round(map.mesh.contentCount * c.Profile.QualityTargets.OceanCoverage.target)
      )
    );
    let boundary = Number.MAX_VALUE;
    for (let i = 0; i < map.mesh.count; i++)
      if (map.mesh.boundary[i]) boundary = Math.min(boundary, map.Elevation[i]);
    map.BaseSeaLevel = Math.max(
      connectedOceanLevel(map, target) + units(c.Profile.SeaLevel * c.Profile.ElevationScale),
      boundary + units(1)
    );
    map.SeaLevelInitialized = true;
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
    for (let edge = 0; edge < 3; edge++) mark(map.mesh.neighbors[queue[head] * 3 + edge]);
}
